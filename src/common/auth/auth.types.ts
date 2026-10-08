import { MembershipRole } from '@prisma/client';

/** Identidade autenticada (carregada pelo JwtStrategy a cada requisição). */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** organização default contida no access token */
  tokenOrganizationId?: string;
}

/** Contexto do tenant validado contra Membership pelo OrganizationContextGuard. */
export interface TenantContext {
  organizationId: string;
  role: MembershipRole;
  membershipId: string;
}

export interface AccessTokenPayload {
  sub: string;
  orgId?: string;
}

export interface RefreshTokenPayload {
  sub: string;
  orgId?: string;
  jti: string;
}

export const ORGANIZATION_HEADER = 'x-organization-id';
