import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { Trim } from '../../../common/validation/transformers';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAvailabilityDto {
  /** Responsável pela agenda (padrão: o próprio usuário; outros apenas OWNER/ADMIN) */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'ownerUserId deve ser um UUID' })
  ownerUserId?: string;

  /** Dia da semana: 0 (domingo) a 6 (sábado) */
  @ApiProperty({ example: 1, minimum: 0, maximum: 6 })
  @Type(() => Number)
  @IsInt({ message: 'dayOfWeek deve ser um inteiro' })
  @Min(0, { message: 'dayOfWeek deve estar entre 0 e 6' })
  @Max(6, { message: 'dayOfWeek deve estar entre 0 e 6' })
  dayOfWeek: number;

  /** Início da janela (HH:mm, UTC) */
  @ApiProperty({ example: '09:00' })
  @Matches(TIME_REGEX, { message: 'startTime deve estar no formato HH:mm' })
  startTime: string;

  /** Fim da janela (HH:mm, UTC) */
  @ApiProperty({ example: '18:00' })
  @Matches(TIME_REGEX, { message: 'endTime deve estar no formato HH:mm' })
  endTime: string;
}

export class ListAvailabilityQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'ownerUserId deve ser um UUID' })
  ownerUserId?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;
}

export class SlotsQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Padrão: o próprio usuário' })
  @IsOptional()
  @IsUUID('all', { message: 'ownerUserId deve ser um UUID' })
  ownerUserId?: string;

  /** Data (YYYY-MM-DD, UTC) */
  @ApiProperty({ example: '2026-10-12' })
  @Matches(DATE_REGEX, { message: 'date deve estar no formato YYYY-MM-DD' })
  date: string;

  /** Duração do atendimento em minutos (5 a 480) */
  @ApiPropertyOptional({ default: 60, minimum: 5, maximum: 480 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'durationMinutes deve ser um inteiro' })
  @Min(5)
  @Max(480)
  durationMinutes?: number;
}

export class CreateAppointmentDto {
  /** Responsável pelo atendimento (padrão: o próprio usuário) */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'ownerUserId deve ser um UUID' })
  ownerUserId?: string;

  @ApiProperty({ example: 'João Costa' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'customerName deve ter ao menos 2 caracteres' })
  @MaxLength(120)
  customerName: string;

  @ApiPropertyOptional({ example: 'Mentoria' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  serviceName?: string;

  /** Início (ISO 8601, UTC) */
  @ApiProperty({ example: '2026-10-12T14:00:00Z' })
  @IsISO8601({ strict: true }, { message: 'startAt deve ser uma data ISO 8601 válida' })
  startAt: string;

  /** Fim (ISO 8601, UTC) */
  @ApiProperty({ example: '2026-10-12T15:00:00Z' })
  @IsISO8601({ strict: true }, { message: 'endAt deve ser uma data ISO 8601 válida' })
  endAt: string;
}

export class ListAppointmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'ownerUserId deve ser um UUID' })
  ownerUserId?: string;

  @ApiPropertyOptional({ enum: AppointmentStatus })
  @IsOptional()
  @IsEnum(AppointmentStatus, { message: 'status deve ser CONFIRMED ou CANCELLED' })
  status?: AppointmentStatus;

  /** Agendamentos que começam a partir desta data */
  @ApiPropertyOptional({ example: '2026-10-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from deve ser uma data ISO 8601 válida' })
  from?: string;

  /** Agendamentos que começam até esta data */
  @ApiPropertyOptional({ example: '2026-10-31T23:59:59Z' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to deve ser uma data ISO 8601 válida' })
  to?: string;
}
