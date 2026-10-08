import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

/** Documenta o contrato de erro padrão (seção 10) nos endpoints. */
export function ApiStandardErrors(...extra: number[]) {
  const base: Record<number, string> = {
    400: 'VALIDATION_ERROR — payload inválido',
    401: 'AUTHENTICATION_REQUIRED — token ausente ou inválido',
    403: 'FORBIDDEN — sem permissão',
    404: 'RESOURCE_NOT_FOUND — recurso inexistente ou fora do tenant',
    409: 'CONFLICT — conflito de estado/unicidade/agendamento',
    422: 'BUSINESS_RULE_VIOLATION — regra de negócio impede a operação',
  };
  const codes = new Set([400, 401, 403, ...extra]);
  return applyDecorators(
    ...[...codes].map((status) => ApiResponse({ status, description: base[status] ?? 'Erro' })),
  );
}
