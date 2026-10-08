import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export const API = '/api/v1';
export const PASSWORD = 'Senha@12345';

/** ConfigService que sobrescreve chaves específicas (útil para variar limites em um teste). */
class OverridableConfig extends ConfigService {
  constructor(private readonly overrides: Record<string, unknown>) {
    super();
  }
  get(key: any, defaultValue?: any): any {
    return key in this.overrides ? this.overrides[key] : super.get(key, defaultValue);
  }
  getOrThrow(key: any): any {
    return key in this.overrides ? this.overrides[key] : super.getOrThrow(key);
  }
}

export async function createApp(
  configOverrides?: Record<string, unknown>,
): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (configOverrides)
    builder.overrideProvider(ConfigService).useValue(new OverridableConfig(configOverrides));
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(false);
  configureApp(app);
  await app.init();
  return app;
}

export const uniq = () => randomUUID().replace(/-/g, '').slice(0, 12);

export interface Session {
  email: string;
  userId: string;
  organizationId: string;
  accessToken: string;
  refreshToken: string;
}

/** Registra um usuário + organização (o usuário vira OWNER). */
export async function register(app: INestApplication, label = 'org'): Promise<Session> {
  const id = uniq();
  const email = `${label}-${id}@example.com`;
  const res = await request(app.getHttpServer())
    .post(`${API}/auth/register`)
    .send({ name: `Dono ${id}`, email, password: PASSWORD, organizationName: `Org ${label} ${id}` })
    .expect(201);
  return {
    email,
    userId: res.body.user.id,
    organizationId: res.body.organization.id,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

export const auth = (s: Pick<Session, 'accessToken'>) => ({
  Authorization: `Bearer ${s.accessToken}`,
});

/** Adiciona um membro à organização do OWNER e devolve a sessão dele (logado na org). */
export async function addMemberAndLogin(
  app: INestApplication,
  owner: Session,
  role: 'ADMIN' | 'MEMBER' | 'STUDENT',
): Promise<Session> {
  const id = uniq();
  const email = `${role.toLowerCase()}-${id}@example.com`;
  const add = await request(app.getHttpServer())
    .post(`${API}/organizations/me/members`)
    .set(auth(owner))
    .send({ email, role, name: `${role} ${id}`, password: PASSWORD })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post(`${API}/auth/login`)
    .send({ email, password: PASSWORD, organizationId: owner.organizationId })
    .expect(200);
  return {
    email,
    userId: add.body.userId,
    organizationId: owner.organizationId,
    accessToken: login.body.accessToken,
    refreshToken: login.body.refreshToken,
  };
}

/** Próxima segunda-feira (UTC), `weeksAhead` semanas à frente, com a hora informada. */
export function futureMonday(hour: number, minute = 0, weeksAhead = 2): Date {
  const d = new Date();
  const daysToMonday = (8 - d.getUTCDay()) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysToMonday + 7 * (weeksAhead - 1));
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}
