import { Body, Controller, Get, Headers, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, ORGANIZATION_HEADER } from '../../common/auth/auth.types';
import { CurrentUser, SkipTenant } from '../../common/auth/decorators';
import { ApiStandardErrors } from '../../common/swagger/api-errors.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@SkipTenant()
@Controller('users/me')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Retorna o perfil do usuário autenticado' })
  @ApiStandardErrors()
  profile(@CurrentUser() user: AuthUser) {
    return this.service.getProfile(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Atualiza o perfil (nome e/ou senha)' })
  @ApiStandardErrors()
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
    @Headers(ORGANIZATION_HEADER) organizationId?: string,
  ) {
    return this.service.updateProfile(user.id, organizationId ?? user.tokenOrganizationId, dto);
  }
}
