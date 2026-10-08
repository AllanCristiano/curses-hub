/** Códigos de erro padronizados (documento, seção 10). */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',
  FORBIDDEN = 'FORBIDDEN',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  CONFLICT = 'CONFLICT',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ErrorDetail {
  field?: string;
  message: string;
}

export interface ErrorResponseBody {
  statusCode: number;
  error: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  requestId?: string;
}
