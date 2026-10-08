import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { AuthService } from '../../src/modules/auth/auth.service';
import { auditMock, createPrismaMock } from './helpers';

const env: Record<string, string> = {
  JWT_ACCESS_SECRET: 'a',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'r',
  JWT_REFRESH_EXPIRES_IN: '7d',
  BCRYPT_ROUNDS: '4',
};
const config = {
  get: (k: string) => env[k],
  getOrThrow: (k: string) => env[k],
} as unknown as ConfigService;

function setup() {
  const prisma = createPrismaMock();
  const audit = auditMock();
  const service = new AuthService(prisma, new JwtService(), config, audit as any);
  return { prisma, audit, service };
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('AuthService', () => {
  it('armazena a senha apenas como hash bcrypt (nunca em texto puro)', async () => {
    const { service } = setup();
    const hash = await service.hashPassword('Senha@12345');
    expect(hash).not.toContain('Senha@12345');
    expect(await bcrypt.compare('Senha@12345', hash)).toBe(true);
  });

  describe('login', () => {
    it('rejeita senha incorreta com 401', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@a.com',
        name: 'A',
        status: 'ACTIVE',
        passwordHash: await bcrypt.hash('certa123', 4),
      });
      await expect(
        service.login({ email: 'a@a.com', password: 'errada123' }),
      ).rejects.toMatchObject({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
      });
    });

    it('rejeita usuário inexistente com a mesma resposta (sem enumeração)', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'x@x.com', password: 'qualquer123' }),
      ).rejects.toMatchObject({
        status: 401,
        message: 'Credenciais inválidas',
      });
    });

    it('autentica, devolve access + refresh token e guarda apenas o hash do refresh', async () => {
      const { prisma, audit, service } = setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@a.com',
        name: 'A',
        status: 'ACTIVE',
        passwordHash: await bcrypt.hash('certa123', 4),
      });
      prisma.membership.findFirst.mockResolvedValue({
        organizationId: 'o1',
        role: 'OWNER',
        organization: { id: 'o1', name: 'Org', slug: 'org' },
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const res = await service.login({ email: 'a@a.com', password: 'certa123' });

      expect(res.accessToken).toEqual(expect.any(String));
      expect(res.refreshToken).toEqual(expect.any(String));
      expect(res.organization).toMatchObject({ id: 'o1', role: 'OWNER' });
      expect(prisma.refreshToken.create.mock.calls[0][0].data.tokenHash).toBe(
        sha256(res.refreshToken),
      );
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login' }));
    });

    it('usuário sem organização ativa recebe 403', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        status: 'ACTIVE',
        passwordHash: await bcrypt.hash('certa123', 4),
      });
      prisma.membership.findFirst.mockResolvedValue(null);
      await expect(service.login({ email: 'a@a.com', password: 'certa123' })).rejects.toMatchObject(
        { status: 403 },
      );
    });
  });

  describe('refresh', () => {
    async function issued() {
      const ctx = setup();
      ctx.prisma.refreshToken.create.mockResolvedValue({});
      const tokens = await ctx.service.issueTokens('u1', 'o1');
      return { ...ctx, tokens };
    }

    it('rotaciona: revoga o token usado e emite um novo par', async () => {
      const { prisma, service, tokens } = await issued();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: 'ACTIVE' });
      prisma.membership.findFirst.mockResolvedValue({ organizationId: 'o1' });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const next = await service.refresh({ refreshToken: tokens.refreshToken });

      expect(next.refreshToken).not.toBe(tokens.refreshToken);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1', revokedAt: null } }),
      );
    });

    it('reuso de refresh token revogado derruba todas as sessões do usuário', async () => {
      const { prisma, service, tokens } = await issued();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.refresh({ refreshToken: tokens.refreshToken })).rejects.toMatchObject({
        status: 401,
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
      );
    });

    it('rejeita token com assinatura inválida', async () => {
      const { service } = setup();
      const forged = await new JwtService().signAsync({ sub: 'u1' }, { secret: 'outro' });
      await expect(service.refresh({ refreshToken: forged })).rejects.toMatchObject({
        status: 401,
      });
    });
  });
});
