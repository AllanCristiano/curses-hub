import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  AuthenticationRequiredException,
  ValidationFailedException,
} from '../../common/errors/app.exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

const profileSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  getProfile(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: profileSelect });
  }

  async updateProfile(userId: string, organizationId: string | undefined, dto: UpdateProfileDto) {
    if (dto.name === undefined && dto.newPassword === undefined) {
      throw new ValidationFailedException('Dados inválidos', [
        { message: 'Informe name e/ou newPassword' },
      ]);
    }

    let passwordHash: string | undefined;
    if (dto.newPassword) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const ok = await bcrypt.compare(dto.currentPassword ?? '', user.passwordHash);
      if (!ok) throw new AuthenticationRequiredException('Senha atual incorreta');
      passwordHash = await this.auth.hashPassword(dto.newPassword);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name, passwordHash },
      select: profileSelect,
    });

    if (passwordHash) {
      // troca de senha encerra as sessões existentes
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // só audita em organizações às quais o usuário realmente pertence (header não é confiável)
      const membership = organizationId
        ? await this.prisma.membership.findFirst({ where: { organizationId, userId } })
        : null;
      if (membership) {
        await this.audit.log({
          organizationId: membership.organizationId,
          userId,
          action: 'user.password_changed',
          resource: 'user',
          resourceId: userId,
        });
      }
    }
    return updated;
  }
}
