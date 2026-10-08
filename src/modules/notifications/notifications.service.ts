import { Injectable } from '@nestjs/common';
import { MembershipRole, MembershipStatus, Prisma } from '@prisma/client';
import { ResourceNotFoundException } from '../../common/errors/app.exceptions';
import { paginated, resolvePage } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { ListNotificationsQueryDto } from './dto/list-notifications.dto';

export interface NotifyInput {
  organizationId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
}

/** Notificações internas geradas por eventos de domínio (UC09). */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  notify(input: NotifyInput, client: Prisma.TransactionClient = this.prisma) {
    return client.notification.create({ data: input });
  }

  /** Notifica OWNER e ADMIN ativos da organização. */
  async notifyManagers(
    input: Omit<NotifyInput, 'userId'>,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const managers = await client.membership.findMany({
      where: {
        organizationId: input.organizationId,
        status: MembershipStatus.ACTIVE,
        role: { in: [MembershipRole.OWNER, MembershipRole.ADMIN] },
      },
      select: { userId: true },
    });
    if (managers.length === 0) return;
    await client.notification.createMany({
      data: managers.map((m) => ({ ...input, userId: m.userId })),
    });
  }

  async list(organizationId: string, userId: string, query: ListNotificationsQueryDto) {
    const page = resolvePage(query);
    const where: Prisma.NotificationWhereInput = {
      organizationId,
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: query.order ?? 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paginated(data, total, page);
  }

  async markAsRead(organizationId: string, userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, organizationId, userId },
    });
    if (!notification) throw new ResourceNotFoundException('Notificação não encontrada');
    if (notification.readAt) return notification;
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllAsRead(organizationId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { organizationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
