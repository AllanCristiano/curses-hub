import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ToLowerCase } from '../../../common/validation/transformers';

export class LoginDto {
  /** E-mail cadastrado */
  @ApiProperty({ example: 'maria@example.com' })
  @ToLowerCase()
  @IsEmail({}, { message: 'E-mail inválido' })
  email: string;

  /** Senha */
  @ApiProperty({ example: 'Senha@12345' })
  @IsString()
  @MaxLength(72)
  password: string;

  /** Organização ativa desejada (padrão: a primeira da qual o usuário participa) */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'organizationId deve ser um UUID' })
  organizationId?: string;
}
