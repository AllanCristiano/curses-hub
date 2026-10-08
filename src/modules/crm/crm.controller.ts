import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { AuthUser, TenantContext } from '../../common/auth/auth.types';
import { CurrentUser, Roles, Tenant } from '../../common/auth/decorators';
import { ApiStandardErrors } from '../../common/swagger/api-errors.decorator';
import { CrmService } from './crm.service';
import { CreateLeadStageDto } from './dto/lead-stage.dto';
import { CreateLeadDto, ListLeadsQueryDto, MoveLeadStageDto, UpdateLeadDto } from './dto/lead.dto';

const INTERNAL = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER] as const;

@ApiTags('CRM')
@ApiBearerAuth()
@ApiSecurity('organization')
@Roles(...INTERNAL)
@Controller()
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Post('leads')
  @ApiOperation({ summary: 'Cria lead (UC03)' })
  @ApiResponse({ status: 201, description: 'Lead criado' })
  @ApiStandardErrors(404)
  create(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: CreateLeadDto) {
    return this.crm.createLead(t.organizationId, u.id, dto);
  }

  @Get('leads')
  @ApiOperation({ summary: 'Lista leads com paginação, filtros e ordenação' })
  @ApiStandardErrors()
  list(@Tenant() t: TenantContext, @Query() query: ListLeadsQueryDto) {
    return this.crm.listLeads(t.organizationId, query);
  }

  @Get('leads/:id')
  @ApiOperation({ summary: 'Detalha lead' })
  @ApiStandardErrors(404)
  get(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.crm.getLead(t.organizationId, id);
  }

  @Patch('leads/:id')
  @ApiOperation({ summary: 'Atualiza lead' })
  @ApiStandardErrors(404)
  update(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.crm.updateLead(t.organizationId, u.id, id, dto);
  }

  @Delete('leads/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Arquiva lead (exclusão lógica)' })
  @ApiResponse({ status: 204, description: 'Lead arquivado' })
  @ApiStandardErrors(404)
  archive(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crm.archiveLead(t.organizationId, u.id, id);
  }

  @Patch('leads/:id/stage')
  @ApiOperation({ summary: 'Move lead de etapa (gera auditoria)' })
  @ApiStandardErrors(404)
  move(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveLeadStageDto,
  ) {
    return this.crm.moveLead(t.organizationId, u.id, id, dto);
  }

  @Get('lead-stages')
  @ApiOperation({ summary: 'Lista etapas do funil' })
  @ApiStandardErrors()
  listStages(@Tenant() t: TenantContext) {
    return this.crm.listStages(t.organizationId);
  }

  @Post('lead-stages')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Cria etapa do funil (OWNER, ADMIN)' })
  @ApiStandardErrors(409)
  createStage(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateLeadStageDto,
  ) {
    return this.crm.createStage(t.organizationId, u.id, dto);
  }
}
