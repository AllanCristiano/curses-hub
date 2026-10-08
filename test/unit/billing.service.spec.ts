import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { BillingService } from '../../src/modules/billing/billing.service';
import { auditMock, createPrismaMock, notificationsMock } from './helpers';

const config = { getOrThrow: () => 'segredo-do-webhook' } as unknown as ConfigService;

function setup() {
  const prisma = createPrismaMock();
  const audit = auditMock();
  const notifications = notificationsMock();
  return {
    prisma,
    audit,
    notifications,
    service: new BillingService(prisma, audit as any, notifications as any, config),
  };
}

const D = (v: string) => new Prisma.Decimal(v);
const pendingInvoice = {
  id: 'i1',
  organizationId: 'o1',
  customerName: 'João',
  total: D('291.00'),
  status: 'PENDING',
};

describe('BillingService', () => {
  describe('createInvoice', () => {
    it('nasce PENDING com subtotal, desconto e total corretos', async () => {
      const { prisma, service } = setup();
      prisma.invoice.create.mockImplementation(async ({ data }: any) => ({ id: 'i1', ...data }));

      const invoice = await service.createInvoice('o1', 'u1', {
        customerName: 'João',
        items: [{ description: 'Mentoria', quantity: 2, unitPrice: 150 }],
        discount: 9,
      });

      const data = prisma.invoice.create.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING');
      expect(data.subtotal.toFixed(2)).toBe('300.00');
      expect(data.total.toFixed(2)).toBe('291.00');
      expect(invoice.id).toBe('i1');
    });

    it('desconto maior que o subtotal retorna 422', async () => {
      const { service } = setup();
      await expect(
        service.createInvoice('o1', 'u1', {
          customerName: 'João',
          items: [{ description: 'x', quantity: 1, unitPrice: 10 }],
          discount: 11,
        }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('payInvoice — transições de status (regra 8.5)', () => {
    it('T08 — pagar fatura já paga retorna 409', async () => {
      const { prisma, service } = setup();
      prisma.invoice.findFirst.mockResolvedValue({ ...pendingInvoice, status: 'PAID' });
      await expect(service.payInvoice('o1', 'u1', 'i1', {})).rejects.toMatchObject({ status: 409 });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('fatura cancelada não pode ser paga (422)', async () => {
      const { prisma, service } = setup();
      prisma.invoice.findFirst.mockResolvedValue({ ...pendingInvoice, status: 'CANCELLED' });
      await expect(service.payInvoice('o1', 'u1', 'i1', {})).rejects.toMatchObject({ status: 422 });
    });

    it('fatura de outro tenant retorna 404', async () => {
      const { prisma, service } = setup();
      prisma.invoice.findFirst.mockResolvedValue(null);
      await expect(service.payInvoice('org-A', 'u1', 'i-da-org-B', {})).rejects.toMatchObject({
        status: 404,
      });
    });

    it('PENDING → PAID cria o pagamento com o valor total, audita e notifica gestores', async () => {
      const { prisma, audit, notifications, service } = setup();
      prisma.invoice.findFirst.mockResolvedValue(pendingInvoice);
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.create.mockResolvedValue({ id: 'p1' });

      await service.payInvoice('o1', 'u1', 'i1', {});

      expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'i1', status: 'PENDING' } }),
      );
      expect(prisma.payment.create.mock.calls[0][0].data.amount.toFixed(2)).toBe('291.00');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invoice.paid' }),
        expect.anything(),
      );
      expect(notifications.notifyManagers).toHaveBeenCalled();
    });

    it('perde a corrida (updateMany = 0) e retorna 409 sem criar pagamento', async () => {
      const { prisma, service } = setup();
      prisma.invoice.findFirst.mockResolvedValue(pendingInvoice);
      prisma.invoice.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.payInvoice('o1', 'u1', 'i1', {})).rejects.toMatchObject({ status: 409 });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook — idempotência', () => {
    const event = { eventId: 'evt_1', invoiceId: 'i1', amount: 291 };

    it('segredo inválido retorna 401', async () => {
      const { service } = setup();
      await expect(service.handleWebhook(event, 'errado')).rejects.toMatchObject({ status: 401 });
      await expect(service.handleWebhook(event, undefined)).rejects.toMatchObject({ status: 401 });
    });

    it('evento já processado devolve duplicate=true sem tocar na fatura', async () => {
      const { prisma, service } = setup();
      prisma.payment.findUnique.mockResolvedValue({ id: 'p1' });

      const res = await service.handleWebhook(event, 'segredo-do-webhook');

      expect(res).toEqual({ received: true, duplicate: true, paymentId: 'p1' });
      expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('T09 — primeiro evento cria o pagamento com externalId = eventId', async () => {
      const { prisma, service } = setup();
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.invoice.findFirst.mockResolvedValue(pendingInvoice);
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.create.mockResolvedValue({ id: 'p1' });

      const res = await service.handleWebhook(event, 'segredo-do-webhook');

      expect(res).toEqual({ received: true, duplicate: false, paymentId: 'p1' });
      expect(prisma.payment.create.mock.calls[0][0].data.externalId).toBe('evt_1');
    });

    it('entrega simultânea perdedora (fatura já paga) vira duplicate=true', async () => {
      const { prisma, service } = setup();
      prisma.payment.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'p1' });
      prisma.invoice.findFirst.mockResolvedValue({ ...pendingInvoice, status: 'PAID' });

      const res = await service.handleWebhook(event, 'segredo-do-webhook');

      expect(res).toEqual({ received: true, duplicate: true, paymentId: 'p1' });
    });

    it('valor diferente do total retorna 422', async () => {
      const { prisma, service } = setup();
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.invoice.findFirst.mockResolvedValue(pendingInvoice);
      await expect(
        service.handleWebhook({ ...event, amount: 100 }, 'segredo-do-webhook'),
      ).rejects.toMatchObject({ status: 422 });
    });
  });
});
