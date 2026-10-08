import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsJWT, IsOptional, IsUUID } from 'class-validator';

export class RefreshDto {
  /** Refresh token recebido no login */
  @ApiProperty()
  @IsJWT({ message: 'refreshToken inválido' })
  refreshToken: string;

  /** Alterna a organização ativa (validada contra Membership) */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'organizationId deve ser um UUID' })
  organizationId?: string;
}

export class LogoutDto {
  /** Refresh token a ser revogado */
  @ApiProperty()
  @IsJWT({ message: 'refreshToken inválido' })
  refreshToken: string;
}
