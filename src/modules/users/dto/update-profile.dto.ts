import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Trim } from '../../../common/validation/transformers';

export class UpdateProfileDto {
  /** Novo nome */
  @ApiPropertyOptional({ example: 'Maria S. Silva' })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Nome deve ter ao menos 2 caracteres' })
  @MaxLength(120)
  name?: string;

  /** Senha atual (obrigatória ao trocar a senha) */
  @ApiPropertyOptional()
  @ValidateIf((o: UpdateProfileDto) => o.newPassword !== undefined)
  @IsString({ message: 'currentPassword é obrigatória para trocar a senha' })
  @MaxLength(72)
  currentPassword?: string;

  /** Nova senha */
  @ApiPropertyOptional({ example: 'NovaSenha@123' })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Senha deve ter ao menos 8 caracteres' })
  @MaxLength(72)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Senha deve conter letras e números' })
  newPassword?: string;
}
