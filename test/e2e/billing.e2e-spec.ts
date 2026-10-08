import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { API, auth, createApp, register, uniq } from './helpers';

describe('Billing (E2E)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const SECRET = 'test-webhook-secret';

  beforeAll(async () => (app = await createApp()));
  afterAll(async () => app.close());

  const body = {
    customerName: 'João Costa',
    items: [{ description: 'Mentoria individual', quantity: 2, unitPrice: 150 }],
    discount: 9,
  };

  it('cria fatura PENDING com total = itens − desconto (precisão decimal) e itens persistidos', async () => {
    const owner = await register(app);
    const res = await http().post(`${API}/invoices`).set(auth(owner)).send(body).expect(201);
    expect(res.body).toMatchObject({
      status: 'PENDING',
      subtotal: '300',
      discount: '9',
      total: '291',
      customerName: 'João Costa',
    });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ quantity: 2, unitPrice: '150', total: '300' });

    const dec = await http()
      .post(`${API}/invoices`)
      .set(auth(owner))
      .send({
        customerName: 'Preciso',
        items: [{ description: 'Item', quantity: 3, unitPrice: 0.1 }],
      })
      .expect(201);
    expect(dec.body.total).toBe('0.3');
  });

  it('validações: sem itens, valores negativos/casas extras e desconto acima do subtotal', async () => {
    const owner = await register(app);
    await http()
      .post(`${API}/invoices`)
      .set(auth(owner))
      .send({ customerName: 'X Y', items: [] })
      .expect(400);
    await http()
      .post(`${API}/invoices`)
      .set(auth(owner))
      .send({ customerName: 'X Y', items: [{ description: 'ab', quantity: 1, unitPrice: -5 }] })
      .expect(400);
    await http()
      .post(`${API}/invoices`)
      .set(auth(owner))
      .send({ customerName: 'X Y', items: [{ description: 'ab', quantity: 1, unitPrice: 1.999 }] })
      .expect(400);
    await http()
      .post(`${API}/invoices`)
      .set(auth(owner))
      .send({ customerName: 'X Y', items: [{ description: 'ab', quantity: 0, unitPrice: 5 }] })
      .expect(400);
    const over = await http()
      .post(`${API}/invoices`)
      .set(auth(owner))
      .send({
        customerName: 'X Y',
        items: [{ description: 'ab', quantity: 1, unitPrice: 10 }],
        discount: 11,
      })
      .expect(422);
    expect(over.body.error).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('UC08 — pagamento simulado altera o estado; T08 — pagar de novo retorna 409', async () => {
    const owner = await register(app);
    const inv = (await http().post(`${API}/invoices`).set(auth(owner)).send(body).expect(201)).body;

    const paid = await http()
      .patch(`${API}/invoices/${inv.id}/pay`)
      .set(auth(owner))
      .send({ method: 'PIX' })
      .expect(200);
    expect(paid.body).toMatchObject({ status: 'PAID', paidAt: expect.any(String) });
    expect(paid.body.payments).toHaveLength(1);
    expect(paid.body.payments[0]).toMatchObject({
      amount: '291',
      method: 'PIX',
      status: 'CONFIRMED',
    });

    const again = await http()
      .patch(`${API}/invoices/${inv.id}/pay`)
      .set(auth(owner))
      .send({})
      .expect(409);
    expect(again.body.error).toBe('CONFLICT');
    const detail = await http().get(`${API}/invoices/${inv.id}`).set(auth(owner)).expect(200);
    expect(detail.body.payments).toHaveLength(1);

    // pagamento gera notificação e auditoria
    const notes = await http().get(`${API}/notifications`).set(auth(owner)).expect(200);
    expect(notes.body.data.map((n: any) => n.type)).toContain('INVOICE_PAID');
    const prisma = app.get(PrismaService);
    expect(
      await prisma.auditLog.count({ where: { resourceId: inv.id, action: 'invoice.paid' } }),
    ).toBe(1);
  });

  it('pagamentos concorrentes da mesma fatura geram um único pagamento', async () => {
    const owner = await register(app);
    const inv = (await http().post(`${API}/invoices`).set(auth(owner)).send(body).expect(201)).body;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        http().patch(`${API}/invoices/${inv.id}/pay`).set(auth(owner)).send({}),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    const prisma = app.get(PrismaService);
    expect(await prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(1);
  });

  it('fatura cancelada não pode ser paga (422)', async () => {
    const owner = await register(app);
    const inv = (await http().post(`${API}/invoices`).set(auth(owner)).send(body).expect(201)).body;
    await app
      .get(PrismaService)
      .invoice.update({ where: { id: inv.id }, data: { status: 'CANCELLED' } });
    const res = await http()
      .patch(`${API}/invoices/${inv.id}/pay`)
      .set(auth(owner))
      .send({})
      .expect(422);
    expect(res.body.error).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('T09 — webhook processado duas vezes gera um único pagamento', async () => {
    const owner = await register(app);
    const inv = (await http().post(`${API}/invoices`).set(auth(owner)).send(body).expect(201)).body;
    const event = { eventId: `evt_${uniq()}`, invoiceId: inv.id, amount: 291, method: 'PIX' };

    const first = await http()
      .post(`${API}/payments/webhook`)
      .set('x-webhook-secret', SECRET)
      .send(event)
      .expect(200);
    expect(first.body).toMatchObject({ received: true, duplicate: false });
    const second = await http()
      .post(`${API}/payments/webhook`)
      .set('x-webhook-secret', SECRET)
      .send(event)
      .expect(200);
    expect(second.body).toEqual({
      received: true,
      duplicate: true,
      paymentId: first.body.paymentId,
    });

    const detail = await http().get(`${API}/invoices/${inv.id}`).set(auth(owner)).expect(200);
    expect(detail.body.status).toBe('PAID');
    expect(detail.body.payments).toHaveLength(1);
    expect(detail.body.payments[0].externalId).toBe(event.eventId);
  });

  it('webhook entregue em paralelo (mesmo eventId) continua idempotente', async () => {
    const owner = await register(app);
    const inv = (await http().post(`${API}/invoices`).set(auth(owner)).send(body).expect(201)).body;
    const event = { eventId: `evt_${uniq()}`, invoiceId: inv.id, amount: 291 };
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        http().post(`${API}/payments/webhook`).set('x-webhook-secret', SECRET).send(event),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.paymentId)).size).toBe(1);
    expect(await app.get(PrismaService).payment.count({ where: { invoiceId: inv.id } })).toBe(1);
  });

  it('webhook: segredo inválido (401), fatura inexistente (404), valor divergente (422) e evento novo para fatura paga (409)', async () => {
    const owner = await register(app);
    const inv = (await http().post(`${API}/invoices`).set(auth(owner)).send(body).expect(201)).body;
    const ev = (extra = {}) => ({
      eventId: `evt_${uniq()}`,
      invoiceId: inv.id,
      amount: 291,
      ...extra,
    });

    await http().post(`${API}/payments/webhook`).send(ev()).expect(401);
    await http()
      .post(`${API}/payments/webhook`)
      .set('x-webhook-secret', 'errado')
      .send(ev())
      .expect(401);
    await http()
      .post(`${API}/payments/webhook`)
      .set('x-webhook-secret', SECRET)
      .send(ev({ invoiceId: '00000000-0000-4000-8000-000000000000' }))
      .expect(404);
    await http()
      .post(`${API}/payments/webhook`)
      .set('x-webhook-secret', SECRET)
      .send(ev({ amount: 100 }))
      .expect(422);
    await http()
      .post(`${API}/payments/webhook`)
      .set('x-webhook-secret', SECRET)
      .send({ eventId: '', invoiceId: 'x', amount: -1 })
      .expect(400);

    await http()
      .post(`${API}/payments/webhook`)
      .set('x-webhook-secret', SECRET)
      .send(ev())
      .expect(200);
    await http()
      .post(`${API}/payments/webhook`)
      .set('x-webhook-secret', SECRET)
      .send(ev())
      .expect(409);
  });

  it('listagem com filtros por status e busca por cliente, paginada', async () => {
    const owner = await register(app);
    for (const name of ['Ana Lima', 'Bruno Dias', 'Ana Souza']) {
      await http()
        .post(`${API}/invoices`)
        .set(auth(owner))
        .send({ ...body, customerName: name })
        .expect(201);
    }
    const first = (await http().get(`${API}/invoices?search=ana`).set(auth(owner)).expect(200))
      .body;
    expect(first.meta.total).toBe(2);
    await http()
      .patch(`${API}/invoices/${first.data[0].id}/pay`)
      .set(auth(owner))
      .send({})
      .expect(200);
    expect(
      (await http().get(`${API}/invoices?status=PAID`).set(auth(owner)).expect(200)).body.meta
        .total,
    ).toBe(1);
    expect(
      (await http().get(`${API}/invoices?status=PENDING&limit=2`).set(auth(owner)).expect(200)).body
        .meta,
    ).toMatchObject({ total: 2, limit: 2 });
    await http().get(`${API}/invoices?status=INVALIDO`).set(auth(owner)).expect(400);
  });
});
