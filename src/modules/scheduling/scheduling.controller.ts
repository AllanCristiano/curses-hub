import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { AuthUser, TenantContext } from '../../common/auth/auth.types';
import { CurrentUser, Roles, Tenant } from '../../common/auth/decorators';
import { ApiStandardErrors } from '../../common/swagger/api-errors.decorator';
import {
  CreateAppointmentDto,
  CreateAvailabilityDto,
  ListAppointmentsQueryDto,
  ListAvailabilityQueryDto,
  SlotsQueryDto,
} from './dto/scheduling.dto';
import { SchedulingService } from './scheduling.service';

const actorOf = (user: AuthUser, tenant: TenantContext) => ({ id: user.id, role: tenant.role });

@ApiTags('Scheduling')
@ApiBearerAuth()
@ApiSecurity('organization')
@Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER)
@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Post('availability')
  @ApiOperation({ summary: 'Cria janela de disponibilidade' })
  @ApiStandardErrors(404, 409)
  createAvailability(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateAvailabilityDto,
  ) {
    return this.scheduling.createAvailability(t.organizationId, actorOf(u, t), dto);
  }

  @Get('availability')
  @ApiOperation({ summary: 'Consulta janelas de disponibilidade' })
  @ApiStandardErrors()
  listAvailability(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Query() q: ListAvailabilityQueryDto,
  ) {
    return this.scheduling.listAvailability(t.organizationId, actorOf(u, t), q);
  }

  @Get('appointments/slots')
  @ApiOperation({ summary: 'Calcula os horários disponíveis de um responsável em uma data' })
  @ApiStandardErrors(404)
  slots(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Query() q: SlotsQueryDto) {
    return this.scheduling.getSlots(t.organizationId, actorOf(u, t), q);
  }

  @Post('appointments')
  @ApiOperation({
    summary: 'Cria agendamento (UC07) — sem passado, sem overlap, dentro da disponibilidade',
  })
  @ApiResponse({ status: 201, description: 'Agendamento criado' })
  @ApiResponse({
    status: 409,
    description: 'CONFLICT — Horário indisponível ou fora da disponibilidade',
  })
  @ApiStandardErrors(404, 422)
  create(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.scheduling.createAppointment(t.organizationId, actorOf(u, t), dto);
  }

  @Get('appointments')
  @ApiOperation({ summary: 'Lista agendamentos com filtros e paginação' })
  @ApiStandardErrors()
  list(@Tenant() t: TenantContext, @Query() q: ListAppointmentsQueryDto) {
    return this.scheduling.listAppointments(t.organizationId, q);
  }

  @Patch('appointments/:id/cancel')
  @ApiOperation({ summary: 'Cancela agendamento (altera o status; não apaga o registro)' })
  @ApiStandardErrors(404, 409)
  cancel(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.scheduling.cancelAppointment(t.organizationId, actorOf(u, t), id);
  }
}
