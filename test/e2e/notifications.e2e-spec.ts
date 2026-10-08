import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { API, addMemberAndLogin, auth, createApp, register } from './helpers';

describe('Notifications (E2E)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => (app = await createApp()));
  afterAll(async () => app.close());

  it('UC09 — lista, marca uma como lida e marca todas como lidas; notificações são privadas', async () => {
    const owner = await register(app);
    const m1 = await addMemberAndLogin(app, owner, 'MEMBER');
    const m2 = await addMemberAndLogin(app, owner, 'MEMBER');

    // adicionar membro gera MEMBER_ADDED para ele
    const list = await http().get(`${API}/notifications`).set(auth(m1)).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ type: 'MEMBER_ADDED', readAt: null });

    // o outro membro não enxerga nem altera a notificação alheia
    const id = list.body.data[0].id;
    await http().patch(`${API}/notifications/${id}/read`).set(auth(m2)).expect(404);

    const read = await http().patch(`${API}/notifications/${id}/read`).set(auth(m1)).expect(200);
    expect(read.body.readAt).toEqual(expect.any(String));
    expect(
      (await http().get(`${API}/notifications?unreadOnly=true`).set(auth(m1)).expect(200)).body
        .data,
    ).toHaveLength(0);

    const prisma = app.get(PrismaService);
    await prisma.notification.createMany({
      data: [1, 2, 3].map((i) => ({
        organizationId: owner.organizationId,
        userId: m1.userId,
        type: 'TEST',
        title: `n${i}`,
      })),
    });
    const all = await http().post(`${API}/notifications/read-all`).set(auth(m1)).expect(200);
    expect(all.body).toEqual({ updated: 3 });
    expect(
      (await http().get(`${API}/notifications?unreadOnly=true`).set(auth(m1)).expect(200)).body.meta
        .total,
    ).toBe(0);
    await http().patch(`${API}/notifications/nao-uuid/read`).set(auth(m1)).expect(400);
  });
});
