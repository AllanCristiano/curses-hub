import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { createHash, timingSafeEqual } from 'crypto';
import {
  AuthenticationRequiredException,
  BusinessRuleException,
  ConflictAppException,
  ResourceNotFoundException,
} from '../../common/errors/app.exceptions';
import { paginated, resolvePage } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateInvoiceDto,
  ListInvoicesQueryDto,
  PayInvoiceDto,
  PaymentWebhookDto,
} from './dto/billing.dto';
import { calculateInvoiceTotals } from './invoice.util';

const invoiceInclude = {
  items: true,
  payments: { orderBy: { paidAt: 'asc' } },
} satisfies Prisma.InvoiceInclude;

interface SettleInput {
  invoiceId: string;
  /** Presente nos fluxos autenticados; o webhook localiza a fatura somente pelo ID do evento. */
  organizationId?: string;
  actorId?: string;
  method: PaymentMethod;
  externalId?: string;
  /** Valor informado pelo provedor — deve coincidir com o total da fatura */
  amount?: Prisma.Decimal;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  // UC08 — Emitir fatura (nasce PENDING)
  async createInvoice(organizationId: string, userId: string, dto: CreateInvoiceDto) {
    const totals = calculateInvoiceTotals(dto.items, dto.discount ?? 0);

    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          customerName: dto.customerName,
          subtotal: totals.subtotal,
          discount: totals.discount,
          total: totals.total,
          status: InvoiceStatus.PENDING,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          items: { create: totals.lines },
        },
        include: invoiceInclude,
      });
      await this.audit.log(
        {
          organizationId,
          userId,
          action: 'invoice.created',
          resource: 'invoice',
          resourceId: invoice.id,
          metadata: { total: invoice.total.toString() },
        },
        tx,
      );
      return invoice;
    });
  }

  async listInvoices(organizationId: string, query: ListInvoicesQueryDto) {
    const page = resolvePage(query);
    const search = query.search?.trim();
    const where: Prisma.InvoiceWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(search ? { customerName: { contains: search, mode: 'insensitive' } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: query.order ?? 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginated(data, total, page);
  }

  async getInvoice(organizationId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      include: invoiceInclude,
    });
    if (!invoice) throw new ResourceNotFoundException('Fatura não encontrada');
    return invoice;
  }

  // UC08 — Registrar pagamento simulado
  async payInvoice(organizationId: string, userId: string, id: string, dto: PayInvoiceDto) {
    await this.getInvoice(organizationId, id); // 404 se for de outro tenant
    const { payment } = await this.settle({
      invoiceId: id,
      organizationId,
      actorId: userId,
      method: dto.method ?? PaymentMethod.SIMULATED,
    });
    return { ...(await this.getInvoice(organizationId, id)), payment };
  }

  /**
   * Webhook de pagamento — idempotente por `eventId` (Payment.externalId é UNIQUE).
   * Eventos duplicados retornam o mesmo pagamento, sem novo efeito.
   */
  async handleWebhook(dto: PaymentWebhookDto, providedSecret: string | undefined) {
    this.assertWebhookSecret(providedSecret);

    const duplicate = await this.findByEvent(dto.eventId);
    if (duplicate) return { received: true, duplicate: true, paymentId: duplicate.id };

    try {
      const { payment } = await this.settle({
        invoiceId: dto.invoiceId,
        method: dto.method ?? PaymentMethod.SIMULATED,
        externalId: dto.eventId,
        amount: new Prisma.Decimal(dto.amount),
      });
      return { received: true, duplicate: false, paymentId: payment.id };
    } catch (error) {
      // corrida entre entregas simultâneas do mesmo evento: a perdedora vira "duplicado"
      const raced = await this.findByEvent(dto.eventId);
      if (raced) return { received: true, duplicate: true, paymentId: raced.id };
      throw error;
    }
  }

  // ------------------------------------------------------------------- helpers

  /**
   * Quita a fatura de forma atômica. A transição PENDING → PAID é condicional (`updateMany`
   * com `status = PENDING`), então duas requisições concorrentes nunca pagam duas vezes.
   */
  private async settle(input: SettleInput) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id: input.invoiceId,
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        },
      });
      if (!invoice) throw new ResourceNotFoundException('Fatura não encontrada');

      // regra 8.5: pagamento só em fatura não cancelada; fatura paga não é paga de novo
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BusinessRuleException('Não é possível pagar uma fatura cancelada');
      }
      if (invoice.status === InvoiceStatus.PAID)
        throw new ConflictAppException('Fatura já está paga');
      if (input.amount && !input.amount.equals(invoice.total)) {
        throw new BusinessRuleException('Valor do pagamento difere do total da fatura');
      }

      const paidAt = new Date();
      const moved = await tx.invoice.updateMany({
        where: { id: invoice.id, status: InvoiceStatus.PENDING },
        data: { status: InvoiceStatus.PAID, paidAt },
      });
      if (moved.count === 0) throw new ConflictAppException('Fatura já está paga');

      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: invoice.total,
          method: input.method,
          status: PaymentStatus.CONFIRMED,
          externalId: input.externalId,
          paidAt,
        },
      });

      await this.audit.log(
        {
          organizationId: invoice.organizationId,
          userId: input.actorId ?? null,
          action: 'invoice.paid',
          resource: 'invoice',
          resourceId: invoice.id,
          metadata: {
            paymentId: payment.id,
            amount: invoice.total.toString(),
            via: input.externalId ? 'webhook' : 'manual',
          },
        },
        tx,
      );
      await this.notifications.notifyManagers(
        {
          organizationId: invoice.organizationId,
          type: 'INVOICE_PAID',
          title: 'Fatura paga',
          body: `${invoice.customerName} — ${invoice.total.toString()}`,
        },
        tx,
      );
      return { invoice, payment };
    });
  }

  private findByEvent(eventId: string) {
    return this.prisma.payment.findUnique({ where: { externalId: eventId } });
  }

  private assertWebhookSecret(provided: string | undefined) {
    const expected = this.config.getOrThrow<string>('PAYMENT_WEBHOOK_SECRET');
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!provided || !timingSafeEqual(digest(provided), digest(expected))) {
      throw new AuthenticationRequiredException('Assinatura do webhook inválida');
    }
  }
}
