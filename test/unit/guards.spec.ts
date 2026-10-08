import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationContextGuard } from '../../src/common/guards/organization-context.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { Roles } from '../../src/common/auth/decorators';
import { createPrismaMock } from './helpers';

function ctx(req: any, handler: any = () => undefined, cls: any = class {}) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

describe('OrganizationContextGuard (isolamento multi-tenant)', () => {
  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';

  it('exige Membership ativa na organização informada (403 caso contrário)', async () => {
    const prisma = createPrismaMock();
    prisma.membership.findUnique.mockResolvedValue(null);
    const guard = new OrganizationContextGuard(new Reflector(), prisma);
    const req = {
      user: { id: 'u1', tokenOrganizationId: orgA },
      headers: { 'x-organization-id': orgB },
    };
    await expect(guard.canActivate(ctx(req))).rejects.toMatchObject({ status: 403 });
    expect(prisma.membership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_userId: { organizationId: orgB, userId: 'u1' } },
      }),
    );
  });

  it('o header x-organization-id tem precedência sobre o token, mas é validado', async () => {
    const prisma = createPrismaMock();
    prisma.membership.findUnique.mockResolvedValue({
      id: 'm1',
      role: 'ADMIN',
      status: 'ACTIVE',
      organization: { status: 'ACTIVE' },
    });
    const guard = new OrganizationContextGuard(new Reflector(), prisma);
    const req: any = {
      user: { id: 'u1', tokenOrganizationId: orgA },
      headers: { 'x-organization-id': orgB },
    };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.tenant).toEqual({ organizationId: orgB, role: 'ADMIN', membershipId: 'm1' });
  });

  it('vínculo inativo ou organização suspensa é negado', async () => {
    const prisma = createPrismaMock();
    const guard = new OrganizationContextGuard(new Reflector(), prisma);
    const req = { user: { id: 'u1', tokenOrganizationId: orgA }, headers: {} };
    prisma.membership.findUnique.mockResolvedValue({
      id: 'm1',
      role: 'ADMIN',
      status: 'INACTIVE',
      organization: { status: 'ACTIVE' },
    });
    await expect(guard.canActivate(ctx(req))).rejects.toMatchObject({ status: 403 });
    prisma.membership.findUnique.mockResolvedValue({
      id: 'm1',
      role: 'ADMIN',
      status: 'ACTIVE',
      organization: { status: 'SUSPENDED' },
    });
    await expect(guard.canActivate(ctx(req))).rejects.toMatchObject({ status: 403 });
  });

  it('header que não é UUID retorna 400', async () => {
    const guard = new OrganizationContextGuard(new Reflector(), createPrismaMock());
    const req = { user: { id: 'u1' }, headers: { 'x-organization-id': "1' OR '1'='1" } };
    await expect(guard.canActivate(ctx(req))).rejects.toMatchObject({ status: 400 });
  });
});

describe('RolesGuard (RBAC)', () => {
  class Controller {
    @Roles('OWNER' as any)
    ownerOnly() {}
    open() {}
  }
  const guard = new RolesGuard(new Reflector());

  it('T10 — MEMBER tentando ação de OWNER recebe 403', () => {
    const req = { tenant: { role: 'MEMBER' } };
    expect(() => guard.canActivate(ctx(req, Controller.prototype.ownerOnly, Controller))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('OWNER é autorizado e rotas sem @Roles ficam abertas', () => {
    expect(
      guard.canActivate(
        ctx({ tenant: { role: 'OWNER' } }, Controller.prototype.ownerOnly, Controller),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        ctx({ tenant: { role: 'STUDENT' } }, Controller.prototype.open, Controller),
      ),
    ).toBe(true);
  });
});
