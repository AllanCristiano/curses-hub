import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { AuthUser, TenantContext } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
export const SKIP_TENANT_KEY = 'skipTenant';
export const ROLES_KEY = 'roles';

/** Rota sem autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Rota autenticada, mas que não exige contexto de organização. */
export const SkipTenant = () => SetMetadata(SKIP_TENANT_KEY, true);

/** Restringe a rota aos papéis informados (RBAC por organização). */
export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);

export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    return ctx.switchToHttp().getRequest().tenant;
  },
);
