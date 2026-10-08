import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  IsEnum,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { Trim } from '../../../common/validation/transformers';

export class CreateLessonDto {
  /** Título da aula */
  @ApiProperty({ example: 'Introdução ao NestJS' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Título da aula deve ter ao menos 2 caracteres' })
  @MaxLength(150)
  title: string;

  /** URL do conteúdo (vídeo/arquivo hospedado externamente) */
  @ApiPropertyOptional({ example: 'https://example.com/aula-1' })
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'contentUrl deve ser uma URL válida' })
  @MaxLength(500)
  contentUrl?: string;
}

export class CreateModuleDto {
  /** Título do módulo */
  @ApiProperty({ example: 'Fundamentos' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Título do módulo deve ter ao menos 2 caracteres' })
  @MaxLength(150)
  title: string;

  /** Aulas do módulo (a posição segue a ordem do array) */
  @ApiPropertyOptional({ type: [CreateLessonDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateLessonDto)
  lessons?: CreateLessonDto[];
}

export const CREATABLE_COURSE_STATUS = [CourseStatus.DRAFT, CourseStatus.PUBLISHED] as const;

export class CreateCourseDto {
  /** Título do curso */
  @ApiProperty({ example: 'Backend com NestJS' })
  @Trim()
  @IsString()
  @MinLength(3, { message: 'Título deve ter ao menos 3 caracteres' })
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ example: 'Do zero a uma API completa' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** Status inicial (padrão DRAFT). Somente cursos PUBLISHED aceitam matrícula */
  @ApiPropertyOptional({ enum: CREATABLE_COURSE_STATUS, default: CourseStatus.DRAFT })
  @IsOptional()
  @IsIn(CREATABLE_COURSE_STATUS, { message: 'status deve ser DRAFT ou PUBLISHED' })
  status?: (typeof CREATABLE_COURSE_STATUS)[number];

  /** Módulos e aulas (a posição segue a ordem dos arrays) */
  @ApiPropertyOptional({ type: [CreateModuleDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateModuleDto)
  modules?: CreateModuleDto[];
}

export class UpdateCourseDto {
  @ApiPropertyOptional({ example: 'Backend com NestJS — 2ª edição' })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: CourseStatus })
  @IsOptional()
  @IsEnum(CourseStatus, { message: 'status deve ser DRAFT, PUBLISHED ou ARCHIVED' })
  status?: CourseStatus;
}

export class ListCoursesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'nest' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Alunos (STUDENT) enxergam apenas cursos PUBLISHED, independentemente deste filtro */
  @ApiPropertyOptional({ enum: CourseStatus })
  @IsOptional()
  @IsEnum(CourseStatus, { message: 'status deve ser DRAFT, PUBLISHED ou ARCHIVED' })
  status?: CourseStatus;
}

export class EnrollDto {
  /** Aluno a matricular (somente OWNER/ADMIN). Padrão: o próprio usuário */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'userId deve ser um UUID' })
  userId?: string;
}

export class ProgressQueryDto {
  /** Consulta o progresso de outro aluno (somente OWNER/ADMIN) */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'userId deve ser um UUID' })
  userId?: string;
}

export class ListEnrollmentsQueryDto extends PaginationQueryDto {}
