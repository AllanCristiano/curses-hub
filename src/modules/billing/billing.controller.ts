import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { AuthUser, TenantContext } from '../../common/auth/auth.types';
import { CurrentUser, Public, Roles, SkipTenant, Tenant } from '../../common/auth/decorators';
import { ApiStandardErrors } from '../../common/swagger/api-errors.decorator';
import { BillingService } from './billing.service';
import {
  CreateInvoiceDto,
  ListInvoicesQueryDto,
  PayInvoiceDto,
  PaymentWebhookDto,
} from './dto/billing.dto';

@ApiTags('Billing')
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('invoices')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiBearerAuth()
  @ApiSecurity('organization')
  @ApiOperation({ summary: 'Cria fatura PENDING com itens e desconto (OWNER, ADMIN)' })
  @ApiResponse({ status: 201, description: 'Fatura criada (valores monetários em string decimal)' })
  @ApiStandardErrors(422)
  create(@Tenant() t: TenantContext, @CurrentUser() u: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.billing.createInvoice(t.organizationId, u.id, dto);
  }

  @Get('invoices')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiBearerAuth()
  @ApiSecurity('organization')
  @ApiOperation({ summary: 'Lista faturas com filtros e paginação (OWNER, ADMIN)' })
  @ApiStandardErrors()
  list(@Tenant() t: TenantContext, @Query() q: ListInvoicesQueryDto) {
    return this.billing.listInvoices(t.organizationId, q);
  }

  @Get('invoices/:id')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiBearerAuth()
  @ApiSecurity('organization')
  @ApiOperation({ summary: 'Detalha fatura com itens e pagamentos (OWNER, ADMIN)' })
  @ApiStandardErrors(404)
  get(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.getInvoice(t.organizationId, id);
  }

  @Patch('invoices/:id/pay')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiBearerAuth()
  @ApiSecurity('organization')
  @ApiOperation({ summary: 'Registra pagamento simulado (409 se já paga; 422 se cancelada)' })
  @ApiStandardErrors(404, 409, 422)
  pay(
    @Tenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayInvoiceDto,
  ) {
    return this.billing.payInvoice(t.organizationId, u.id, id, dto);
  }

  @Public()
  @SkipTenant()
  @Post('payments/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: 'x-webhook-secret',
    description: 'Segredo compartilhado (PAYMENT_WEBHOOK_SECRET)',
  })
  @ApiOperation({ summary: 'Recebe evento de pagamento — idempotente por eventId' })
  @ApiResponse({ status: 200, description: '`duplicate: true` quando o evento já foi processado' })
  @ApiStandardErrors(404, 409, 422)
  webhook(@Body() dto: PaymentWebhookDto, @Headers('x-webhook-secret') secret?: string) {
    return this.billing.handleWebhook(dto, secret);
  }
}
