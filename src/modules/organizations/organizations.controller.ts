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
import {
  AddMemberDto,
  ListMembersQueryDto,
  UpdateMemberDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('organizations/me')
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Consulta a organização atual' })
  @ApiStandardErrors()
  getCurrent(@Tenant() tenant: TenantContext) {
    return this.service.getCurrent(tenant.organizationId);
  }

  @Patch()
  @Roles(MembershipRole.OWNER)
  @ApiOperation({ summary: 'Atualiza dados da organização (OWNER)' })
  @ApiStandardErrors(409)
  update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.service.updateCurrent(tenant.organizationId, user.id, dto);
  }

  @Get('members')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Lista membros (OWNER, ADMIN)' })
  @ApiStandardErrors()
  listMembers(@Tenant() tenant: TenantContext, @Query() query: ListMembersQueryDto) {
    return this.service.listMembers(tenant.organizationId, query);
  }

  @Post('members')
  @Roles(MembershipRole.OWNER)
  @ApiOperation({ summary: 'Adiciona membro (OWNER)' })
  @ApiStandardErrors(409)
  addMember(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: AddMemberDto,
  ) {
    return this.service.addMember(tenant.organizationId, user.id, dto);
  }

  @Patch('members/:userId')
  @Roles(MembershipRole.OWNER)
  @ApiOperation({ summary: 'Atualiza papel/status de um membro (OWNER)' })
  @ApiStandardErrors(404, 422)
  updateMember(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.service.updateMember(tenant.organizationId, user.id, userId, dto);
  }

  @Delete('members/:userId')
  @Roles(MembershipRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove um membro (OWNER)' })
  @ApiResponse({ status: 204, description: 'Membro removido' })
  @ApiStandardErrors(404, 422)
  removeMember(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.service.removeMember(tenant.organizationId, user.id, userId);
  }
}
