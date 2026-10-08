import { SchedulingService } from '../../src/modules/scheduling/scheduling.service';
import { auditMock, createPrismaMock, notificationsMock } from './helpers';

function setup() {
  const prisma = createPrismaMock();
  const audit = auditMock();
  const notifications = notificationsMock();
  return {
    prisma,
    audit,
    notifications,
    service: new SchedulingService(prisma, audit as any, notifications as any),
  };
}

const actor = { id: 'u1', role: 'MEMBER' as const };

/** Próxima segunda-feira às 14:00 UTC, bem no futuro dos testes. */
function futureMonday(hour: number, minutes = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7);
  d.setUTCHours(hour, minutes, 0, 0);
  return d;
}
const window = [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }];

describe('SchedulingService.createAppointment (regra 8.4)', () => {
  it('rejeita horário no passado (422)', async () => {
    const { service } = setup();
    await expect(
      service.createAppointment('o1', actor, {
        customerName: 'João',
        startAt: '2020-01-06T14:00:00Z',
        endAt: '2020-01-06T15:00:00Z',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'BUSINESS_RULE_VIOLATION' });
  });

  it('rejeita fim antes do início (400)', async () => {
    const { service } = setup();
    const start = futureMonday(14);
    await expect(
      service.createAppointment('o1', actor, {
        customerName: 'João',
        startAt: start.toISOString(),
        endAt: futureMonday(13).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('T07 — fora da disponibilidade retorna 409', async () => {
    const { prisma, service } = setup();
    prisma.availability.findMany.mockResolvedValue(window);
    await expect(
      service.createAppointment('o1', actor, {
        customerName: 'João',
        startAt: futureMonday(20).toISOString(),
        endAt: futureMonday(21).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it('T06 — horário ocupado retorna 409 e não cria o agendamento', async () => {
    const { prisma, service } = setup();
    prisma.availability.findMany.mockResolvedValue(window);
    prisma.appointment.findMany.mockResolvedValue([
      { startAt: futureMonday(14, 30), endAt: futureMonday(15, 30) },
    ]);
    await expect(
      service.createAppointment('o1', actor, {
        customerName: 'João',
        startAt: futureMonday(14).toISOString(),
        endAt: futureMonday(15).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 409, message: 'Horário indisponível' });
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it('horário encostado em outro agendamento é permitido e a reserva usa lock + transação', async () => {
    const { prisma, audit, service } = setup();
    prisma.availability.findMany.mockResolvedValue(window);
    prisma.appointment.findMany.mockResolvedValue([
      { startAt: futureMonday(13), endAt: futureMonday(14) },
    ]);
    prisma.appointment.create.mockResolvedValue({ id: 'ap1' });

    const res = await service.createAppointment('o1', actor, {
      customerName: 'João',
      startAt: futureMonday(14).toISOString(),
      endAt: futureMonday(15).toISOString(),
    });

    expect(res.id).toBe('ap1');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled(); // pg_advisory_xact_lock
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'appointment.created' }),
      expect.anything(),
    );
  });

  it('responsável que não é membro da organização retorna 404', async () => {
    const { prisma, service } = setup();
    prisma.membership.findFirst.mockResolvedValue(null);
    await expect(
      service.createAppointment('o1', actor, {
        ownerUserId: 'estranho',
        customerName: 'João',
        startAt: futureMonday(14).toISOString(),
        endAt: futureMonday(15).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('SchedulingService.cancelAppointment', () => {
  it('altera o status para CANCELLED sem apagar o registro', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue({
      id: 'ap1',
      status: 'CONFIRMED',
      ownerUserId: 'u1',
      customerName: 'João',
      startAt: new Date(),
    });
    prisma.appointment.update.mockResolvedValue({ id: 'ap1', status: 'CANCELLED' });

    await service.cancelAppointment('o1', actor, 'ap1');

    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
    expect(prisma.appointment.delete).not.toHaveBeenCalled();
  });

  it('cancelar duas vezes retorna 409', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue({ id: 'ap1', status: 'CANCELLED' });
    await expect(service.cancelAppointment('o1', actor, 'ap1')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('agendamento de outro tenant retorna 404', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(null);
    await expect(service.cancelAppointment('org-A', actor, 'ap-da-org-B')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
      where: { id: 'ap-da-org-B', organizationId: 'org-A' },
    });
  });
});
