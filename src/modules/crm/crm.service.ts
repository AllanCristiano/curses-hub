import { Injectable } from '@nestjs/common';
import { LeadStatus, Prisma } from '@prisma/client';
import {
  ConflictAppException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../../common/errors/app.exceptions';
import { paginated, resolvePage } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateLeadStageDto } from './dto/lead-stage.dto';
import { CreateLeadDto, ListLeadsQueryDto, MoveLeadStageDto, UpdateLeadDto } from './dto/lead.dto';

const leadInclude = { stage: { select: { id: true, name: true } } } satisfies Prisma.LeadInclude;

/** Regra 8.2: o lead precisa de nome e pelo menos um canal de contato. */
export function assertHasContactChannel(email?: string | null, phone?: string | null) {
  if (!email && !phone) {
    throw new ValidationFailedException('Dados inválidos', [
      { field: 'email', message: 'Informe ao menos um canal de contato (e-mail ou telefone)' },
    ]);
  }
}

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- etapas

  listStages(organizationId: string) {
    return this.prisma.leadStage.findMany({
      where: { organizationId },
      orderBy: { position: 'asc' },
    });
  }

  async createStage(organizationId: string, userId: string, dto: CreateLeadStageDto) {
    let position = dto.position;
    if (position === undefined) {
      const last = await this.prisma.leadStage.aggregate({
        where: { organizationId },
        _max: { position: true },
      });
      position = (last._max.position ?? 0) + 1;
    }
    const taken = await this.prisma.leadStage.findUnique({
      where: { organizationId_position: { organizationId, position } },
    });
    if (taken) throw new ConflictAppException('Já existe uma etapa nessa posição');

    const stage = await this.prisma.leadStage.create({
      data: { organizationId, name: dto.name, position, isClosed: dto.isClosed ?? false },
    });
    await this.audit.log({
      organizationId,
      userId,
      action: 'lead_stage.created',
      resource: 'lead_stage',
      resourceId: stage.id,
    });
    return stage;
  }

  // ----------------------------------------------------------------- leads

  async createLead(organizationId: string, userId: string, dto: CreateLeadDto) {
    assertHasContactChannel(dto.email, dto.phone);
    const stage = dto.stageId
      ? await this.findStage(organizationId, dto.stageId)
      : await this.prisma.leadStage.findFirst({
          where: { organizationId },
          orderBy: { position: 'asc' },
        });
    if (!stage) throw new ResourceNotFoundException('Nenhuma etapa de lead cadastrada');

    const lead = await this.prisma.lead.create({
      data: {
        organizationId,
        stageId: stage.id,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        source: dto.source,
      },
      include: leadInclude,
    });
    await this.audit.log({
      organizationId,
      userId,
      action: 'lead.created',
      resource: 'lead',
      resourceId: lead.id,
    });
    return lead;
  }

  async listLeads(organizationId: string, query: ListLeadsQueryDto) {
    const page = resolvePage(query);
    const search = query.search?.trim();
    const where: Prisma.LeadWhereInput = {
      organizationId,
      status: query.status ?? LeadStatus.ACTIVE,
      ...(query.stageId ? { stageId: query.stageId } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        include: leadInclude,
        orderBy: { [query.sort ?? 'createdAt']: query.order ?? 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.lead.count({ where }),
    ]);
    return paginated(data, total, page);
  }

  async getLead(organizationId: string, id: string) {
    // nunca busca só pelo ID: sempre combinado com a organização (documento 8.1)
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId },
      include: leadInclude,
    });
    if (!lead) throw new ResourceNotFoundException('Lead não encontrado');
    return lead;
  }

  async updateLead(organizationId: string, userId: string, id: string, dto: UpdateLeadDto) {
    const current = await this.getLead(organizationId, id);
    assertHasContactChannel(dto.email ?? current.email, dto.phone ?? current.phone);

    const lead = await this.prisma.lead.update({
      where: { id: current.id },
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        source: dto.source,
        status: dto.status,
      },
      include: leadInclude,
    });
    await this.audit.log({
      organizationId,
      userId,
      action: 'lead.updated',
      resource: 'lead',
      resourceId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return lead;
  }

  async archiveLead(organizationId: string, userId: string, id: string) {
    const current = await this.getLead(organizationId, id);
    await this.prisma.lead.update({
      where: { id: current.id },
      data: { status: LeadStatus.ARCHIVED },
    });
    await this.audit.log({
      organizationId,
      userId,
      action: 'lead.archived',
      resource: 'lead',
      resourceId: id,
    });
  }

  /** Regra 8.2: mudança de etapa gera AuditLog; a etapa deve pertencer à mesma organização. */
  async moveLead(organizationId: string, userId: string, id: string, dto: MoveLeadStageDto) {
    const current = await this.getLead(organizationId, id);
    const stage = await this.findStage(organizationId, dto.stageId);

    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id: current.id },
        data: { stageId: stage.id },
        include: leadInclude,
      });
      await this.audit.log(
        {
          organizationId,
          userId,
          action: 'lead.stage_changed',
          resource: 'lead',
          resourceId: id,
          metadata: { fromStageId: current.stageId, toStageId: stage.id },
        },
        tx,
      );
      return lead;
    });
  }

  private async findStage(organizationId: string, stageId: string) {
    const stage = await this.prisma.leadStage.findFirst({ where: { id: stageId, organizationId } });
    if (!stage) throw new ResourceNotFoundException('Etapa de lead não encontrada');
    return stage;
  }
}
