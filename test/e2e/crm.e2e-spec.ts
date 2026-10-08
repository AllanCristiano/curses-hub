import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { API, auth, createApp, register } from './helpers';

describe('CRM (E2E)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => (app = await createApp()));
  afterAll(async () => app.close());

  it('UC03 / T01 — fluxo registro → login → criação de lead (contrato do apêndice A.1)', async () => {
    const s = await register(app);
    const stages = (await http().get(`${API}/lead-stages`).set(auth(s)).expect(200)).body;
    const res = await http()
      .post(`${API}/leads`)
      .set(auth(s))
      .send({
        name: 'Maria Silva',
        email: 'MARIA@example.com',
        phone: '79999999999',
        source: 'WEBSITE',
        stageId: stages[0].id,
      })
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'Maria Silva',
      email: 'maria@example.com',
      status: 'ACTIVE',
      stage: { id: stages[0].id, name: 'Novo' },
    });
  });

  it('T02 — e-mail inválido retorna 400; sem canal de contato também', async () => {
    const s = await register(app);
    const bad = await http()
      .post(`${API}/leads`)
      .set(auth(s))
      .send({ name: 'Maria', email: 'invalido' })
      .expect(400);
    expect(bad.body.details[0]).toMatchObject({ field: 'email', message: 'E-mail inválido' });
    await http().post(`${API}/leads`).set(auth(s)).send({ name: 'Sem contato' }).expect(400);
    await http()
      .post(`${API}/leads`)
      .set(auth(s))
      .send({ name: 'Tel inválido', phone: 'abc' })
      .expect(400);
  });

  it('filtros, busca, ordenação e paginação (limite máximo respeitado)', async () => {
    const s = await register(app);
    const stages = (await http().get(`${API}/lead-stages`).set(auth(s)).expect(200)).body;
    for (let i = 1; i <= 25; i++) {
      await http()
        .post(`${API}/leads`)
        .set(auth(s))
        .send({
          name: `Lead ${String(i).padStart(2, '0')}`,
          email: `lead${i}@example.com`,
          source: i % 2 ? 'WEBSITE' : 'INSTAGRAM',
          stageId: stages[i % 2].id,
        })
        .expect(201);
    }
    const p1 = await http()
      .get(`${API}/leads?page=1&limit=10&sort=name&order=asc`)
      .set(auth(s))
      .expect(200);
    expect(p1.body.meta).toEqual({ page: 1, limit: 10, total: 25, totalPages: 3 });
    expect(p1.body.data[0].name).toBe('Lead 01');
    const p3 = await http()
      .get(`${API}/leads?page=3&limit=10&sort=name&order=asc`)
      .set(auth(s))
      .expect(200);
    expect(p3.body.data).toHaveLength(5);

    const capped = await http().get(`${API}/leads?limit=1000`).set(auth(s)).expect(200);
    expect(capped.body.meta.limit).toBe(100);

    expect(
      (await http().get(`${API}/leads?search=lead 07`).set(auth(s)).expect(200)).body.meta.total,
    ).toBe(1);
    expect(
      (await http().get(`${API}/leads?source=INSTAGRAM`).set(auth(s)).expect(200)).body.meta.total,
    ).toBe(12);
    expect(
      (await http().get(`${API}/leads?stageId=${stages[1].id}`).set(auth(s)).expect(200)).body.meta
        .total,
    ).toBe(13);
    await http().get(`${API}/leads?page=0`).set(auth(s)).expect(400);
    await http().get(`${API}/leads?sort=passwordHash`).set(auth(s)).expect(400);
  });

  it('mudança de etapa gera AuditLog; arquivar é exclusão lógica', async () => {
    const s = await register(app);
    const prisma = app.get(PrismaService);
    const stages = (await http().get(`${API}/lead-stages`).set(auth(s)).expect(200)).body;
    const lead = (
      await http()
        .post(`${API}/leads`)
        .set(auth(s))
        .send({ name: 'Maria', email: 'm@m.com' })
        .expect(201)
    ).body;

    const moved = await http()
      .patch(`${API}/leads/${lead.id}/stage`)
      .set(auth(s))
      .send({ stageId: stages[2].id })
      .expect(200);
    expect(moved.body.stage.name).toBe('Proposta');
    const logs = await prisma.auditLog.findMany({
      where: { resourceId: lead.id, action: 'lead.stage_changed' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ organizationId: s.organizationId, userId: s.userId });
    expect(logs[0].metadata).toEqual({ fromStageId: stages[0].id, toStageId: stages[2].id });

    await http().delete(`${API}/leads/${lead.id}`).set(auth(s)).expect(204);
    expect((await http().get(`${API}/leads`).set(auth(s)).expect(200)).body.data).toHaveLength(0);
    expect(
      (await http().get(`${API}/leads?status=ARCHIVED`).set(auth(s)).expect(200)).body.data,
    ).toHaveLength(1);
    await http().get(`${API}/leads/${lead.id}`).set(auth(s)).expect(200);
  });

  it('etapas: cria com posição automática e rejeita posição duplicada (409)', async () => {
    const s = await register(app);
    const created = await http()
      .post(`${API}/lead-stages`)
      .set(auth(s))
      .send({ name: 'Negociação' })
      .expect(201);
    expect(created.body.position).toBe(6);
    await http()
      .post(`${API}/lead-stages`)
      .set(auth(s))
      .send({ name: 'Outra', position: 6 })
      .expect(409);
  });

  it('UUID inválido na rota retorna 400', async () => {
    const s = await register(app);
    await http().get(`${API}/leads/nao-e-uuid`).set(auth(s)).expect(400);
  });
});
