import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { API, PASSWORD, auth, createApp, register, uniq } from './helpers';

describe('Auth + contrato de erro (E2E)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => (app = await createApp()));
  afterAll(async () => app.close());

  it('GET /health responde 200 com o banco ativo', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info.database.status).toBe('up');
  });

  it('UC01 — registro cria usuário, organização OWNER e funil padrão', async () => {
    const s = await register(app);
    expect(s.accessToken).toEqual(expect.any(String));
    const stages = await http().get(`${API}/lead-stages`).set(auth(s)).expect(200);
    expect(stages.body.map((x: any) => x.name)).toEqual([
      'Novo',
      'Contato',
      'Proposta',
      'Ganho',
      'Perdido',
    ]);
    const me = await http().get(`${API}/auth/me`).set(auth(s)).expect(200);
    expect(me.body.organization.role).toBe('OWNER');
  });

  it('registro com e-mail duplicado retorna 409 CONFLICT', async () => {
    const s = await register(app);
    const res = await http()
      .post(`${API}/auth/register`)
      .send({
        name: 'Outro',
        email: s.email.toUpperCase(),
        password: PASSWORD,
        organizationName: 'Outra Org',
      })
      .expect(409);
    expect(res.body).toMatchObject({ statusCode: 409, error: 'CONFLICT' });
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it('contrato de erro de validação (seção 10): VALIDATION_ERROR + details + requestId', async () => {
    const res = await http()
      .post(`${API}/auth/register`)
      .send({ name: 'X', email: 'nao-e-email', password: '123', organizationName: '' })
      .expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: 'Dados inválidos',
    });
    expect(res.body.requestId).toEqual(expect.any(String));
    const fields = res.body.details.map((d: any) => d.field);
    expect(fields).toEqual(
      expect.arrayContaining(['name', 'email', 'password', 'organizationName']),
    );
    expect(res.body.details.find((d: any) => d.field === 'email').message).toBe('E-mail inválido');
  });

  it('rejeita propriedades desconhecidas (whitelist + forbidNonWhitelisted)', async () => {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email: 'a@a.com', password: 'x', role: 'OWNER' })
      .expect(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('login válido e inválido; senha nunca aparece na resposta', async () => {
    const s = await register(app);
    const ok = await http()
      .post(`${API}/auth/login`)
      .send({ email: s.email, password: PASSWORD })
      .expect(200);
    expect(JSON.stringify(ok.body)).not.toContain('passwordHash');
    const bad = await http()
      .post(`${API}/auth/login`)
      .send({ email: s.email, password: 'errada123' })
      .expect(401);
    expect(bad.body.error).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rota protegida sem token ou com token inválido retorna 401', async () => {
    const a = await http().get(`${API}/leads`).expect(401);
    expect(a.body.error).toBe('AUTHENTICATION_REQUIRED');
    await http().get(`${API}/leads`).set('Authorization', 'Bearer lixo').expect(401);
  });

  it('refresh rotaciona o token; reutilizar o antigo revoga a sessão inteira; logout revoga', async () => {
    const s = await register(app);
    const r1 = await http()
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: s.refreshToken })
      .expect(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    await http()
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${r1.body.accessToken}`)
      .expect(200);

    // reuso do token antigo => 401 e derruba também o novo
    await http().post(`${API}/auth/refresh`).send({ refreshToken: s.refreshToken }).expect(401);
    await http()
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);

    const login = await http()
      .post(`${API}/auth/login`)
      .send({ email: s.email, password: PASSWORD })
      .expect(200);
    await http()
      .post(`${API}/auth/logout`)
      .send({ refreshToken: login.body.refreshToken })
      .expect(204);
    await http()
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });

  it('rate limiting nos endpoints de autenticação (429)', async () => {
    const limited = await createApp({ AUTH_THROTTLE_LIMIT: 2 });
    try {
      const email = `rl-${uniq()}@example.com`;
      const send = () =>
        request(limited.getHttpServer())
          .post(`${API}/auth/login`)
          .send({ email, password: 'qualquer123' });
      await send().expect(401);
      await send().expect(401);
      const res = await send().expect(429);
      expect(res.body.error).toBe('TOO_MANY_REQUESTS');
    } finally {
      await limited.close();
    }
  });

  it('x-request-id é propagado/gerado', async () => {
    const res = await http().get('/health').set('x-request-id', 'abc-12345678').expect(200);
    expect(res.headers['x-request-id']).toBe('abc-12345678');
    const gen = await http().get('/health').expect(200);
    expect(gen.headers['x-request-id']).toMatch(/^[0-9A-Z]{26}$/);
  });
});
