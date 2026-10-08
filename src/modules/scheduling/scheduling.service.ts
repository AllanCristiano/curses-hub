import { Injectable } from '@nestjs/common';
import { AppointmentStatus, MembershipRole, MembershipStatus, Prisma } from '@prisma/client';
import { advisoryLock } from '../../common/database/transaction';
import {
  BusinessRuleException,
  ConflictAppException,
  ForbiddenAppException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../../common/errors/app.exceptions';
import { paginated, resolvePage } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateAppointmentDto,
  CreateAvailabilityDto,
  ListAppointmentsQueryDto,
  ListAvailabilityQueryDto,
  SlotsQueryDto,
} from './dto/scheduling.dto';
import { generateSlots, isWithinAvailability, overlaps, toMinutes } from './slots.util';

export interface Actor {
  id: string;
  role: MembershipRole;
}

const MANAGERS: MembershipRole[] = [MembershipRole.OWNER, MembershipRole.ADMIN];

@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------ disponibilidade

  async createAvailability(organizationId: string, actor: Actor, dto: CreateAvailabilityDto) {
    if (toMinutes(dto.endTime) <= toMinutes(dto.startTime)) {
      throw new ValidationFailedException('Dados inválidos', [
        { field: 'endTime', message: 'endTime deve ser posterior a startTime' },
      ]);
    }
    const ownerUserId = await this.resolveOwner(organizationId, actor, dto.ownerUserId, true);

    const sameDay = await this.prisma.availability.findMany({
      where: { organizationId, ownerUserId, dayOfWeek: dto.dayOfWeek },
    });
    const clash = sameDay.some(
      (w) =>
        toMinutes(dto.startTime) < toMinutes(w.endTime) &&
        toMinutes(w.startTime) < toMinutes(dto.endTime),
    );
    if (clash)
      throw new ConflictAppException('Janela de disponibilidade sobrepõe outra já cadastrada');

    return this.prisma.availability.create({
      data: {
        organizationId,
        ownerUserId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
  }

  listAvailability(organizationId: string, actor: Actor, query: ListAvailabilityQueryDto) {
    return this.prisma.availability.findMany({
      where: {
        organizationId,
        ownerUserId: query.ownerUserId ?? undefined,
        dayOfWeek: query.dayOfWeek ?? undefined,
      },
      orderBy: [{ ownerUserId: 'asc' }, { dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  // ---------------------------------------------------------------------- slots

  async getSlots(organizationId: string, actor: Actor, query: SlotsQueryDto) {
    const date = new Date(`${query.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== query.date) {
      throw new ValidationFailedException('Dados inválidos', [
        { field: 'date', message: 'date inválida' },
      ]);
    }
    const ownerUserId = await this.resolveOwner(organizationId, actor, query.ownerUserId, false);
    const durationMinutes = query.durationMinutes ?? 60;

    const [windows, busy] = await Promise.all([
      this.prisma.availability.findMany({
        where: { organizationId, ownerUserId, dayOfWeek: date.getUTCDay() },
      }),
      this.prisma.appointment.findMany({
        where: {
          ownerUserId,
          status: AppointmentStatus.CONFIRMED,
          startAt: { lt: new Date(date.getTime() + 24 * 3_600_000) },
          endAt: { gt: date },
        },
        select: { startAt: true, endAt: true },
      }),
    ]);

    const slots = generateSlots({
      date: query.date,
      durationMinutes,
      windows,
      busy,
      now: new Date(),
    });
    return { ownerUserId, date: query.date, durationMinutes, slots };
  }

  // -------------------------------------------------------------- agendamentos

  // UC07 — Agendar atendimento
  async createAppointment(organizationId: string, actor: Actor, dto: CreateAppointmentDto) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) {
      throw new ValidationFailedException('Dados inválidos', [
        { field: 'endAt', message: 'endAt deve ser posterior a startAt' },
      ]);
    }
    // regra 8.4: não permitir horários no passado
    if (startAt < new Date()) throw new BusinessRuleException('Não é possível agendar no passado');

    const ownerUserId = await this.resolveOwner(organizationId, actor, dto.ownerUserId, false);

    // regra 8.4: transação + trava por responsável para impedir dupla reserva
    // (a constraint de exclusão do banco é a última linha de defesa)
    return this.prisma.$transaction(async (tx) => {
      await advisoryLock(tx, `appointment:${ownerUserId}`);

      const windows = await tx.availability.findMany({
        where: { organizationId, ownerUserId, dayOfWeek: startAt.getUTCDay() },
      });
      if (!isWithinAvailability({ startAt, endAt }, windows)) {
        throw new ConflictAppException('Horário fora da disponibilidade configurada');
      }

      const sameOwner = await tx.appointment.findMany({
        where: {
          ownerUserId,
          status: AppointmentStatus.CONFIRMED,
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { startAt: true, endAt: true },
      });
      if (sameOwner.some((a) => overlaps({ startAt, endAt }, a))) {
        throw new ConflictAppException('Horário indisponível');
      }

      const appointment = await tx.appointment.create({
        data: {
          organizationId,
          ownerUserId,
          customerName: dto.customerName,
          serviceName: dto.serviceName,
          startAt,
          endAt,
        },
      });
      await this.audit.log(
        {
          organizationId,
          userId: actor.id,
          action: 'appointment.created',
          resource: 'appointment',
          resourceId: appointment.id,
          metadata: { ownerUserId, startAt: dto.startAt, endAt: dto.endAt },
        },
        tx,
      );
      if (ownerUserId !== actor.id) {
        await this.notifications.notify(
          {
            organizationId,
            userId: ownerUserId,
            type: 'APPOINTMENT_CREATED',
            title: 'Novo agendamento',
            body: `${dto.customerName} — ${startAt.toISOString()}`,
          },
          tx,
        );
      }
      return appointment;
    });
  }

  async listAppointments(organizationId: string, query: ListAppointmentsQueryDto) {
    const page = resolvePage(query);
    const where: Prisma.AppointmentWhereInput = {
      organizationId,
      ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            startAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        orderBy: { startAt: query.order ?? 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return paginated(data, total, page);
  }

  /** Regra 8.4: cancelamento altera o status; o registro nunca é apagado. */
  async cancelAppointment(organizationId: string, actor: Actor, id: string) {
    const current = await this.prisma.appointment.findFirst({ where: { id, organizationId } });
    if (!current) throw new ResourceNotFoundException('Agendamento não encontrado');
    if (current.status === AppointmentStatus.CANCELLED) {
      throw new ConflictAppException('Agendamento já está cancelado');
    }

    return this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.appointment.update({
        where: { id },
        data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date() },
      });
      await this.audit.log(
        {
          organizationId,
          userId: actor.id,
          action: 'appointment.cancelled',
          resource: 'appointment',
          resourceId: id,
        },
        tx,
      );
      if (current.ownerUserId !== actor.id) {
        await this.notifications.notify(
          {
            organizationId,
            userId: current.ownerUserId,
            type: 'APPOINTMENT_CANCELLED',
            title: 'Agendamento cancelado',
            body: `${current.customerName} — ${current.startAt.toISOString()}`,
          },
          tx,
        );
      }
      return cancelled;
    });
  }

  // ------------------------------------------------------------------- helpers

  /** Define o responsável da agenda: o próprio usuário ou (se informado) um membro ativo. */
  private async resolveOwner(
    organizationId: string,
    actor: Actor,
    requested: string | undefined,
    managersOnlyForOthers: boolean,
  ): Promise<string> {
    if (!requested || requested === actor.id) return actor.id;
    if (managersOnlyForOthers && !MANAGERS.includes(actor.role)) throw new ForbiddenAppException();
    const member = await this.prisma.membership.findFirst({
      where: { organizationId, userId: requested, status: MembershipStatus.ACTIVE },
    });
    if (!member) throw new ResourceNotFoundException('Responsável não é membro desta organização');
    return requested;
  }
}
