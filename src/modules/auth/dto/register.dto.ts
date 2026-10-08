import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ToLowerCase, Trim } from '../../../common/validation/transformers';

export class RegisterDto {
  /** Nome completo do usuário */
  @ApiProperty({ example: 'Maria Silva' })
  @Trim()
  @IsString({ message: 'Nome deve ser um texto' })
  @MinLength(2, { message: 'Nome deve ter ao menos 2 caracteres' })
  @MaxLength(120, { message: 'Nome deve ter no máximo 120 caracteres' })
  name: string;

  /** E-mail (único globalmente) */
  @ApiProperty({ example: 'maria@example.com' })
  @ToLowerCase()
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email: string;

  /** Senha — mínimo 8 caracteres, com letras e números */
  @ApiProperty({ example: 'Senha@12345', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8, { message: 'Senha deve ter ao menos 8 caracteres' })
  @MaxLength(72, { message: 'Senha deve ter no máximo 72 caracteres' })
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Senha deve conter letras e números' })
  password: string;

  /** Nome da organização (tenant) criada junto com a conta */
  @ApiProperty({ example: 'Acme Educação' })
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Nome da organização é obrigatório' })
  @MaxLength(120)
  organizationName: string;

  /** Slug único da organização (gerado a partir do nome se omitido) */
  @ApiPropertyOptional({ example: 'acme-educacao' })
  @IsOptional()
  @ToLowerCase()
  @IsString()
  @MinLength(3, { message: 'Slug deve ter ao menos 3 caracteres' })
  @MaxLength(50, { message: 'Slug deve ter no máximo 50 caracteres' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug deve conter apenas letras minúsculas, números e hífens',
  })
  organizationSlug?: string;
}
