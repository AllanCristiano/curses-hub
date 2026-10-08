import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { API, addMemberAndLogin, auth, createApp, futureMonday, register } from './helpers';

describe('Scheduling (E2E)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => (app = await createApp()));
  afterAll(async () => app.close());

  const appt = (start: Date, end: Date, extra: object = {}) => ({
    customerName: 'João Costa',
    serviceName: 'Mentoria',
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    ...extra,
  });

  async function withAvailability() {
    const owner = await register(app);
    await http()
      .post(`${API}/availability`)
      .set(auth(owner))
      .send({ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' })
      .expect(201);
    return owner;
  }

  it('fluxo disponibilidade → slots → agendamento → cancelamento (UC07)', async () => {
    const owner = await withAvailability();
    const date = futureMonday(0).toISOString().slice(0, 10);

    const slots = await http()
      .get(`${API}/appointments/slots?date=${date}&durationMinutes=60`)
      .set(auth(owner))
      .expect(200);
    expect(slots.body.slots).toHaveLength(9);
    expect(slots.body.slots[0].startAt).toBe(`${date}T09:00:00.000Z`);

    const created = await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(14), futureMonday(15)))
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'CONFIRMED',
      ownerUserId: owner.userId,
      customerName: 'João Costa',
    });

    const after = await http()
      .get(`${API}/appointments/slots?date=${date}&durationMinutes=60`)
      .set(auth(owner))
      .expect(200);
    expect(after.body.slots).toHaveLength(8);
    expect(after.body.slots.map((s: any) => s.startAt)).not.toContain(`${date}T14:00:00.000Z`);

    const cancelled = await http()
      .patch(`${API}/appointments/${created.body.id}/cancel`)
      .set(auth(owner))
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelledAt: expect.any(String) });
    await http()
      .patch(`${API}/appointments/${created.body.id}/cancel`)
      .set(auth(owner))
      .expect(409);

    // o registro continua listável e o horário volta a ficar livre
    const list = await http()
      .get(`${API}/appointments?status=CANCELLED`)
      .set(auth(owner))
      .expect(200);
    expect(list.body.data.map((a: any) => a.id)).toContain(created.body.id);
    const freed = await http()
      .get(`${API}/appointments/slots?date=${date}&durationMinutes=60`)
      .set(auth(owner))
      .expect(200);
    expect(freed.body.slots).toHaveLength(9);
    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(14), futureMonday(15)))
      .expect(201);
  });

  it('T06 — horário ocupado retorna 409 (contrato do apêndice A.2); horários encostados são aceitos', async () => {
    const owner = await withAvailability();
    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(14), futureMonday(15)))
      .expect(201);

    const conflict = await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(14, 30), futureMonday(15, 30)))
      .expect(409);
    expect(conflict.body).toMatchObject({
      statusCode: 409,
      error: 'CONFLICT',
      message: 'Horário indisponível',
    });
    expect(conflict.body.requestId).toEqual(expect.any(String));
    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(14), futureMonday(15)))
      .expect(409);

    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(15), futureMonday(16)))
      .expect(201);
    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(13), futureMonday(14)))
      .expect(201);
  });

  it('T07 — fora da disponibilidade retorna 409', async () => {
    const owner = await withAvailability();
    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(20), futureMonday(21)))
      .expect(409);
    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(17, 30), futureMonday(18, 30)))
      .expect(409);
    // dia sem disponibilidade (terça)
    const tuesday = new Date(futureMonday(10).getTime() + 24 * 3_600_000);
    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(tuesday, new Date(tuesday.getTime() + 3_600_000)))
      .expect(409);
  });

  it('horário no passado retorna 422; intervalo invertido e datas inválidas retornam 400', async () => {
    const owner = await withAvailability();
    const past = await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(new Date('2020-01-06T14:00:00Z'), new Date('2020-01-06T15:00:00Z')))
      .expect(422);
    expect(past.body.error).toBe('BUSINESS_RULE_VIOLATION');
    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(15), futureMonday(14)))
      .expect(400);
    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send({ customerName: 'X Y', startAt: 'amanhã', endAt: 'depois' })
      .expect(400);
  });

  it('concorrência — 6 requisições simultâneas pelo mesmo horário resultam em exatamente uma reserva', async () => {
    const owner = await withAvailability();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        http()
          .post(`${API}/appointments`)
          .set(auth(owner))
          .send(appt(futureMonday(10), futureMonday(11))),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    const confirmed = await http()
      .get(`${API}/appointments?status=CONFIRMED`)
      .set(auth(owner))
      .expect(200);
    expect(confirmed.body.meta.total).toBe(1);
  });

  it('agenda de outro membro: validação de vínculo e permissões', async () => {
    const owner = await register(app);
    const member = await addMemberAndLogin(app, owner, 'MEMBER');
    const other = await register(app, 'outra');

    // MEMBER cria a própria disponibilidade, mas não a de terceiros
    await http()
      .post(`${API}/availability`)
      .set(auth(member))
      .send({ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' })
      .expect(201);
    await http()
      .post(`${API}/availability`)
      .set(auth(member))
      .send({ ownerUserId: owner.userId, dayOfWeek: 1, startTime: '09:00', endTime: '12:00' })
      .expect(403);
    // OWNER cria para o membro; janela sobreposta é rejeitada
    await http()
      .post(`${API}/availability`)
      .set(auth(owner))
      .send({ ownerUserId: member.userId, dayOfWeek: 2, startTime: '09:00', endTime: '12:00' })
      .expect(201);
    await http()
      .post(`${API}/availability`)
      .set(auth(owner))
      .send({ ownerUserId: member.userId, dayOfWeek: 2, startTime: '11:00', endTime: '13:00' })
      .expect(409);
    await http()
      .post(`${API}/availability`)
      .set(auth(owner))
      .send({ dayOfWeek: 1, startTime: '12:00', endTime: '09:00' })
      .expect(400);
    await http()
      .post(`${API}/availability`)
      .set(auth(owner))
      .send({ dayOfWeek: 9, startTime: '9h', endTime: '12:00' })
      .expect(400);

    // responsável de outra organização => 404
    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(10), futureMonday(11), { ownerUserId: other.userId }))
      .expect(404);

    // owner agenda para o membro => notifica o membro
    await http()
      .post(`${API}/appointments`)
      .set(auth(owner))
      .send(appt(futureMonday(10), futureMonday(11), { ownerUserId: member.userId }))
      .expect(201);
    const notes = await http()
      .get(`${API}/notifications?unreadOnly=true`)
      .set(auth(member))
      .expect(200);
    expect(notes.body.data.map((n: any) => n.type)).toContain('APPOINTMENT_CREATED');
  });

  it('isolamento: agendamento de uma organização não é listado nem cancelável por outra', async () => {
    const a = await withAvailability();
    const b = await register(app, 'B');
    const created = await http()
      .post(`${API}/appointments`)
      .set(auth(a))
      .send(appt(futureMonday(10), futureMonday(11)))
      .expect(201);
    await http().patch(`${API}/appointments/${created.body.id}/cancel`).set(auth(b)).expect(404);
    expect(
      (await http().get(`${API}/appointments`).set(auth(b)).expect(200)).body.data,
    ).toHaveLength(0);
  });
});
