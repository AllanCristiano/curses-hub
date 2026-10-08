import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { ToLowerCase, Trim } from '../../../common/validation/transformers';

export class UpdateOrganizationDto {
  /** Novo nome da organização */
  @ApiPropertyOptional({ example: 'Acme Educação' })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Nome deve ter ao menos 2 caracteres' })
  @MaxLength(120)
  name?: string;

  /** Novo slug (único) */
  @ApiPropertyOptional({ example: 'acme-educacao' })
  @IsOptional()
  @ToLowerCase()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug deve conter apenas letras minúsculas, números e hífens',
  })
  slug?: string;
}

/** Papéis que podem ser atribuídos pela API de membros (OWNER é exclusivo de quem criou a organização). */
export const ASSIGNABLE_ROLES = [
  MembershipRole.ADMIN,
  MembershipRole.MEMBER,
  MembershipRole.STUDENT,
] as const;

export class AddMemberDto {
  /** E-mail do usuário. Se não existir, será criado (exige name e password) */
  @ApiProperty({ example: 'joao@example.com' })
  @ToLowerCase()
  @IsEmail({}, { message: 'E-mail inválido' })
  email: string;

  /** Papel na organização */
  @ApiProperty({ enum: ASSIGNABLE_ROLES, example: MembershipRole.MEMBER })
  @IsIn(ASSIGNABLE_ROLES, { message: 'role deve ser ADMIN, MEMBER ou STUDENT' })
  role: (typeof ASSIGNABLE_ROLES)[number];

  /** Nome (obrigatório apenas quando o usuário ainda não existe) */
  @ApiPropertyOptional({ example: 'João Costa' })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  /** Senha inicial (obrigatória apenas quando o usuário ainda não existe) */
  @ApiPropertyOptional({ example: 'Senha@12345' })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Senha deve ter ao menos 8 caracteres' })
  @MaxLength(72)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Senha deve conter letras e números' })
  password?: string;
}

export class UpdateMemberDto {
  /** Novo papel */
  @ApiPropertyOptional({ enum: ASSIGNABLE_ROLES })
  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES, { message: 'role deve ser ADMIN, MEMBER ou STUDENT' })
  role?: (typeof ASSIGNABLE_ROLES)[number];

  /** Novo status do vínculo */
  @ApiPropertyOptional({ enum: MembershipStatus })
  @IsOptional()
  @IsEnum(MembershipStatus, { message: 'status deve ser ACTIVE ou INACTIVE' })
  status?: MembershipStatus;
}

export class ListMembersQueryDto extends PaginationQueryDto {}
