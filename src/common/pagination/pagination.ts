import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export const DEFAULT_PAGE_LIMIT = 20;
export const DEFAULT_MAX_PAGE_LIMIT = 100;

/** Query base de listagens: page + limit + ordenação. */
export class PaginationQueryDto {
  /** Página (começa em 1) */
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page deve ser um inteiro' })
  @Min(1, { message: 'page deve ser maior ou igual a 1' })
  page?: number = 1;

  /** Itens por página (limitado por PAGINATION_MAX_LIMIT, padrão 100) */
  @ApiPropertyOptional({ default: DEFAULT_PAGE_LIMIT, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit deve ser um inteiro' })
  @Min(1, { message: 'limit deve ser maior ou igual a 1' })
  limit?: number = DEFAULT_PAGE_LIMIT;

  /** Direção da ordenação */
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order deve ser asc ou desc' })
  order?: 'asc' | 'desc' = 'desc';
}

export interface PageParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export function maxPageLimit(): number {
  const configured = Number(process.env.PAGINATION_MAX_LIMIT);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_PAGE_LIMIT;
}

/** Resolve page/limit aplicando o limite máximo configurável. */
export function resolvePage(query: PaginationQueryDto): PageParams {
  const page = query.page ?? 1;
  const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, maxPageLimit());
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export function paginated<T>(data: T[], total: number, p: PageParams): Paginated<T> {
  return {
    data,
    meta: { page: p.page, limit: p.limit, total, totalPages: Math.ceil(total / p.limit) },
  };
}
