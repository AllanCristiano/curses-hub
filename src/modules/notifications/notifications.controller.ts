import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, TenantContext } from '../../common/auth/auth.types';
import { CurrentUser, Tenant } from '../../common/auth/decorators';
import { ApiStandardErrors } from '../../common/swagger/api-errors.decorator';
import { ListNotificationsQueryDto } from './dto/list-notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as notificações do usuário (na organização ativa)' })
  @ApiStandardErrors()
  list(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.service.list(tenant.organizationId, user.id, query);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marca todas as notificações como lidas' })
  @ApiStandardErrors()
  readAll(@Tenant() tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return this.service.markAllAsRead(tenant.organizationId, user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marca uma notificação como lida' })
  @ApiStandardErrors(404)
  read(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.markAsRead(tenant.organizationId, user.id, id);
  }
}
