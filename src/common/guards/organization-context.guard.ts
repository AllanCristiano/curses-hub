import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipStatus, OrganizationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ORGANIZATION_HEADER, TenantContext } from '../auth/auth.types';
import { IS_PUBLIC_KEY, SKIP_TENANT_KEY } from '../auth/decorators';
import { ForbiddenAppException, ValidationFailedException } from '../errors/app.exceptions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve o tenant da requisição. A organização nunca é aceita cegamente:
 * vem do header `x-organization-id` (troca de organização) ou do access token,
 * e é SEMPRE validada contra Membership ativa (documento, seções 8.1 e 9.1).
 */
@Injectable()
export class OrganizationContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    const header = req.headers[ORGANIZATION_HEADER] as string | undefined;
    const organizationId = header ?? user?.tokenOrganizationId;

    if (!organizationId) throw new ForbiddenAppException('Contexto de organização ausente');
    if (!UUID_RE.test(organizationId)) {
      throw new ValidationFailedException('Dados inválidos', [
        { field: ORGANIZATION_HEADER, message: 'x-organization-id deve ser um UUID' },
      ]);
    }

    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      include: { organization: { select: { status: true } } },
    });

    if (
      !membership ||
      membership.status !== MembershipStatus.ACTIVE ||
      membership.organization.status !== OrganizationStatus.ACTIVE
    ) {
      throw new ForbiddenAppException('Você não pertence a esta organização');
    }

    const tenant: TenantContext = {
      organizationId,
      role: membership.role,
      membershipId: membership.id,
    };
    req.tenant = tenant;
    return true;
  }
}
