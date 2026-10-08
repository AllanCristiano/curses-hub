import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Trim } from '../../../common/validation/transformers';

export class CreateLeadStageDto {
  /** Nome da etapa */
  @ApiProperty({ example: 'Negociação' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Nome deve ter ao menos 2 caracteres' })
  @MaxLength(60)
  name: string;

  /** Posição no funil (padrão: após a última etapa) */
  @ApiPropertyOptional({ example: 6, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'position deve ser um inteiro' })
  @Min(1, { message: 'position deve ser maior ou igual a 1' })
  position?: number;

  /** Etapa de encerramento (ganho/perdido) */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean({ message: 'isClosed deve ser booleano' })
  isClosed?: boolean;
}
