import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthUser, ORGANIZATION_HEADER } from '../../common/auth/auth.types';
import { CurrentUser, Public, SkipTenant } from '../../common/auth/decorators';
import { ApiStandardErrors } from '../../common/swagger/api-errors.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto, RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

/** Rate limiting básico (ThrottlerGuard) nos endpoints de autenticação — documento, seção 9. */
@ApiTags('Auth')
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Cria usuário e organização inicial (o usuário vira OWNER)' })
  @ApiResponse({ status: 201, description: 'Conta criada; retorna access e refresh token' })
  @ApiStandardErrors(409, 429)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autentica e retorna access token + refresh token' })
  @ApiStandardErrors(429)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renova o access token (com rotação do refresh token)' })
  @ApiStandardErrors(429)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o refresh token' })
  @ApiResponse({ status: 204, description: 'Refresh token revogado' })
  @ApiStandardErrors(429)
  logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto);
  }

  @SkipThrottle()
  @SkipTenant()
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Retorna a identidade e o contexto de organização atuais' })
  @ApiStandardErrors()
  me(@CurrentUser() user: AuthUser, @Headers(ORGANIZATION_HEADER) organizationId?: string) {
    return this.auth.me(user.id, organizationId ?? user.tokenOrganizationId);
  }
}
