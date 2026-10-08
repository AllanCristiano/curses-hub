import { Injectable } from '@nestjs/common';
import { MembershipRole, Prisma } from '@prisma/client';
import {
  BusinessRuleException,
  ConflictAppException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../../common/errors/app.exceptions';
import { paginated, resolvePage } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AddMemberDto,
  ListMembersQueryDto,
  UpdateMemberDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';

const memberSelect = {
  id: true,
  userId: true,
  role: true,
  status: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.MembershipSelect;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly auth: AuthService,
  ) {}

  async getCurrent(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new ResourceNotFoundException('Organização não encontrada');
    return org;
  }

  async updateCurrent(organizationId: string, userId: string, dto: UpdateOrganizationDto) {
    if (dto.slug) {
      const taken = await this.prisma.organization.findFirst({
        where: { slug: dto.slug, NOT: { id: organizationId } },
      });
      if (taken) throw new ConflictAppException('Slug da organização já está em uso');
    }
    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { name: dto.name, slug: dto.slug },
    });
    await this.audit.log({
      organizationId,
      userId,
      action: 'organization.updated',
      resource: 'organization',
      resourceId: organizationId,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async listMembers(organizationId: string, query: ListMembersQueryDto) {
    const page = resolvePage(query);
    const where: Prisma.MembershipWhereInput = { organizationId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.membership.findMany({
        where,
        select: memberSelect,
        orderBy: { createdAt: query.order ?? 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.membership.count({ where }),
    ]);
    return paginated(data, total, page);
  }

  async addMember(organizationId: string, actorId: string, dto: AddMemberDto) {
    let user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user) {
      const details = [
        ...(dto.name ? [] : [{ field: 'name', message: 'Nome é obrigatório para novos usuários' }]),
        ...(dto.password
          ? []
          : [{ field: 'password', message: 'Senha é obrigatória para novos usuários' }]),
      ];
      if (details.length > 0) throw new ValidationFailedException('Dados inválidos', details);
      user = await this.prisma.user.create({
        data: {
          name: dto.name!,
          email: dto.email,
          passwordHash: await this.auth.hashPassword(dto.password!),
        },
      });
    }

    const existing = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    if (existing) throw new ConflictAppException('Usuário já é membro desta organização');

    const membership = await this.prisma.$transaction(async (tx) => {
      const created = await tx.membership.create({
        data: { organizationId, userId: user!.id, role: dto.role },
        select: memberSelect,
      });
      await this.audit.log(
        {
          organizationId,
          userId: actorId,
          action: 'member.added',
          resource: 'membership',
          resourceId: created.id,
          metadata: { targetUserId: user!.id, role: dto.role },
        },
        tx,
      );
      await this.notifications.notify(
        {
          organizationId,
          userId: user!.id,
          type: 'MEMBER_ADDED',
          title: 'Você foi adicionado a uma organização',
          body: `Papel: ${dto.role}`,
        },
        tx,
      );
      return created;
    });
    return membership;
  }

  async updateMember(
    organizationId: string,
    actorId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
  ) {
    const target = await this.findMembership(organizationId, targetUserId);
    this.assertNotOwner(target.role, 'Não é possível alterar o papel/status do OWNER');
    if (dto.role === undefined && dto.status === undefined) {
      throw new ValidationFailedException('Dados inválidos', [
        { message: 'Informe role e/ou status' },
      ]);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.membership.update({
        where: { id: target.id },
        data: { role: dto.role, status: dto.status },
        select: memberSelect,
      });
      await this.audit.log(
        {
          organizationId,
          userId: actorId,
          action: dto.role && dto.role !== target.role ? 'member.role_changed' : 'member.updated',
          resource: 'membership',
          resourceId: target.id,
          metadata: {
            targetUserId,
            from: { role: target.role, status: target.status },
            to: { role: updated.role, status: updated.status },
          },
        },
        tx,
      );
      return updated;
    });
  }

  async removeMember(organizationId: string, actorId: string, targetUserId: string) {
    const target = await this.findMembership(organizationId, targetUserId);
    this.assertNotOwner(target.role, 'Não é possível remover o OWNER da organização');

    await this.prisma.$transaction(async (tx) => {
      await tx.membership.delete({ where: { id: target.id } });
      await this.audit.log(
        {
          organizationId,
          userId: actorId,
          action: 'member.removed',
          resource: 'membership',
          resourceId: target.id,
          metadata: { targetUserId, role: target.role },
        },
        tx,
      );
    });
  }

  private async findMembership(organizationId: string, userId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!membership) throw new ResourceNotFoundException('Membro não encontrado');
    return membership;
  }

  private assertNotOwner(role: MembershipRole, message: string) {
    if (role === MembershipRole.OWNER) throw new BusinessRuleException(message);
  }
}
