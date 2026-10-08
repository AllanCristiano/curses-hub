import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  MembershipRole,
  MembershipStatus,
  OrganizationStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { RefreshTokenPayload } from '../../common/auth/auth.types';
import {
  AuthenticationRequiredException,
  ConflictAppException,
  ForbiddenAppException,
} from '../../common/errors/app.exceptions';
import { slugify } from '../../common/utils/slug';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto, RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

export const DEFAULT_LEAD_STAGES = [
  { name: 'Novo', position: 1, isClosed: false },
  { name: 'Contato', position: 2, isClosed: false },
  { name: 'Proposta', position: 3, isClosed: false },
  { name: 'Ganho', position: 4, isClosed: true },
  { name: 'Perdido', position: 5, isClosed: true },
];

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private dummyHash?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private get rounds(): number {
    return Number(this.config.get('BCRYPT_ROUNDS') ?? 12);
  }

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.rounds);
  }

  // UC01 — Criar conta e organização (o usuário vira OWNER)
  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictAppException('E-mail já cadastrado');

    const slug = dto.organizationSlug ?? (await this.uniqueSlug(slugify(dto.organizationName)));
    if (dto.organizationSlug) {
      const slugTaken = await this.prisma.organization.findUnique({ where: { slug } });
      if (slugTaken) throw new ConflictAppException('Slug da organização já está em uso');
    }

    const passwordHash = await this.hashPassword(dto.password);

    try {
      const { user, organization } = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { name: dto.name, email: dto.email, passwordHash },
        });
        const organization = await tx.organization.create({
          data: {
            name: dto.organizationName,
            slug,
            memberships: { create: { userId: user.id, role: MembershipRole.OWNER } },
            leadStages: { create: DEFAULT_LEAD_STAGES },
          },
        });
        await this.audit.log(
          {
            organizationId: organization.id,
            userId: user.id,
            action: 'auth.register',
            resource: 'organization',
            resourceId: organization.id,
          },
          tx,
        );
        return { user, organization };
      });

      const tokens = await this.issueTokens(user.id, organization.id);
      return {
        ...tokens,
        user: { id: user.id, name: user.name, email: user.email },
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          role: MembershipRole.OWNER,
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictAppException('E-mail ou slug da organização já está em uso');
      }
      throw error;
    }
  }

  // UC02 — Entrar no sistema
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // compara sempre um hash (evita enumeração de usuários por tempo de resposta)
    const hash =
      user?.passwordHash ?? (this.dummyHash ??= await this.hashPassword('dummy-password'));
    const valid = await bcrypt.compare(dto.password, hash);
    if (!user || !valid || user.status !== UserStatus.ACTIVE) {
      throw new AuthenticationRequiredException('Credenciais inválidas');
    }

    const membership = await this.resolveMembership(user.id, dto.organizationId);
    if (!membership) {
      throw new ForbiddenAppException(
        dto.organizationId
          ? 'Você não pertence a esta organização'
          : 'Usuário sem organização ativa',
      );
    }

    const tokens = await this.issueTokens(user.id, membership.organizationId);
    await this.audit.log({
      organizationId: membership.organizationId,
      userId: user.id,
      action: 'auth.login',
      resource: 'user',
      resourceId: user.id,
    });

    return {
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email },
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role,
      },
    };
  }

  // Renova o access token com rotação do refresh token (e detecção de reuso)
  async refresh(dto: RefreshDto): Promise<TokenPair> {
    const payload = await this.verifyRefresh(dto.refreshToken);
    const tokenHash = this.hashToken(dto.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.userId !== payload.sub) {
      throw new AuthenticationRequiredException('Refresh token inválido');
    }
    if (stored.revokedAt) {
      // token já usado/revogado: possível roubo → encerra todas as sessões do usuário
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AuthenticationRequiredException('Refresh token revogado');
    }
    if (stored.expiresAt <= new Date()) {
      throw new AuthenticationRequiredException('Refresh token expirado');
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new AuthenticationRequiredException('Refresh token inválido');
    }

    const wanted = dto.organizationId ?? payload.orgId;
    const membership =
      (await this.resolveMembership(user.id, wanted)) ??
      (dto.organizationId ? null : await this.resolveMembership(user.id));
    if (!membership) throw new ForbiddenAppException('Você não pertence a esta organização');

    // rotação atômica: só um refresh concorrente consegue revogar o token
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw new AuthenticationRequiredException('Refresh token revogado');

    return this.issueTokens(user.id, membership.organizationId);
  }

  async logout(dto: LogoutDto): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(dto.refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Identidade atual + organização ativa (quando resolvível) + todas as organizações. */
  async me(userId: string, activeOrganizationId?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, status: true, createdAt: true },
    });
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        organization: { status: OrganizationStatus.ACTIVE },
      },
      include: { organization: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const active = memberships.find((m) => m.organizationId === activeOrganizationId) ?? null;
    return {
      user,
      organization: active ? { ...active.organization, role: active.role } : null,
      memberships: memberships.map((m) => ({
        organizationId: m.organizationId,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
      })),
    };
  }

  // ------------------------------------------------------------------ helpers

  private async resolveMembership(userId: string, organizationId?: string) {
    return this.prisma.membership.findFirst({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        organization: { status: OrganizationStatus.ACTIVE },
        ...(organizationId ? { organizationId } : {}),
      },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async uniqueSlug(base: string): Promise<string> {
    const root = base.length >= 3 ? base : `org-${base || 'hub'}`;
    let candidate = root;
    for (
      let i = 2;
      await this.prisma.organization.findUnique({ where: { slug: candidate } });
      i++
    ) {
      candidate = `${root.slice(0, 44)}-${i}`;
    }
    return candidate;
  }

  async issueTokens(userId: string, organizationId: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, orgId: organizationId },
      {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: this.config.getOrThrow('JWT_ACCESS_EXPIRES_IN') as any,
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, orgId: organizationId, jti: randomUUID() } satisfies RefreshTokenPayload,
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: this.config.getOrThrow('JWT_REFRESH_EXPIRES_IN') as any,
      },
    );
    const { exp } = this.jwt.decode(refreshToken) as { exp: number };
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hashToken(refreshToken), expiresAt: new Date(exp * 1000) },
    });
    return { accessToken, refreshToken };
  }

  private async verifyRefresh(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new AuthenticationRequiredException('Refresh token inválido ou expirado');
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
