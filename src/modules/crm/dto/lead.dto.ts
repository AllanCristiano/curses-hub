import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { ToLowerCase, Trim } from '../../../common/validation/transformers';

const PHONE_REGEX = /^\+?\d{8,15}$/;

export class CreateLeadDto {
  /** Nome do lead */
  @ApiProperty({ example: 'Maria Silva' })
  @Trim()
  @IsString({ message: 'Nome deve ser um texto' })
  @MinLength(2, { message: 'Nome deve ter ao menos 2 caracteres' })
  @MaxLength(120)
  name: string;

  /** E-mail (ao menos um canal de contato: e-mail ou telefone) */
  @ApiPropertyOptional({ example: 'maria@example.com' })
  @IsOptional()
  @ToLowerCase()
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;

  /** Telefone com DDD, apenas dígitos (8 a 15), "+" opcional */
  @ApiPropertyOptional({ example: '79999999999' })
  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, { message: 'Telefone inválido (use apenas dígitos, de 8 a 15)' })
  phone?: string;

  /** Origem do lead */
  @ApiPropertyOptional({ example: 'WEBSITE' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(50)
  source?: string;

  /** Etapa do funil (padrão: primeira etapa da organização) */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'stageId deve ser um UUID' })
  stageId?: string;
}

export class UpdateLeadDto {
  @ApiPropertyOptional({ example: 'Maria S. Silva' })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'maria@example.com', nullable: true })
  @IsOptional()
  @ToLowerCase()
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;

  @ApiPropertyOptional({ example: '79999999999', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, { message: 'Telefone inválido (use apenas dígitos, de 8 a 15)' })
  phone?: string;

  @ApiPropertyOptional({ example: 'INSTAGRAM' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(50)
  source?: string;

  /** Permite reativar um lead arquivado */
  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus, { message: 'status deve ser ACTIVE ou ARCHIVED' })
  status?: LeadStatus;
}

export class MoveLeadStageDto {
  /** Nova etapa do lead */
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'stageId deve ser um UUID' })
  stageId: string;
}

export class ListLeadsQueryDto extends PaginationQueryDto {
  /** Busca por nome, e-mail ou telefone */
  @ApiPropertyOptional({ example: 'maria' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'stageId deve ser um UUID' })
  stageId?: string;

  /** Padrão: ACTIVE */
  @ApiPropertyOptional({ enum: LeadStatus, default: LeadStatus.ACTIVE })
  @IsOptional()
  @IsEnum(LeadStatus, { message: 'status deve ser ACTIVE ou ARCHIVED' })
  status?: LeadStatus;

  @ApiPropertyOptional({ example: 'WEBSITE' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(50)
  source?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'updatedAt', 'name'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'name'], {
    message: 'sort deve ser createdAt, updatedAt ou name',
  })
  sort?: 'createdAt' | 'updatedAt' | 'name';
}
