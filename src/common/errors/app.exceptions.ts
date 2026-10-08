import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorDetail } from './error-codes';

export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super({ statusCode: status, error: code, message, details }, status);
  }
}

/** 400 — payload inválido. */
export class ValidationFailedException extends AppException {
  constructor(message = 'Dados inválidos', details?: ErrorDetail[]) {
    super(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, message, details);
  }
}

/** 401 — token ausente/inválido ou credenciais incorretas. */
export class AuthenticationRequiredException extends AppException {
  constructor(message = 'Autenticação necessária') {
    super(HttpStatus.UNAUTHORIZED, ErrorCode.AUTHENTICATION_REQUIRED, message);
  }
}

/** 403 — sem permissão. */
export class ForbiddenAppException extends AppException {
  constructor(message = 'Você não tem permissão para realizar esta ação') {
    super(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, message);
  }
}

/** 404 — recurso inexistente ou fora do tenant. */
export class ResourceNotFoundException extends AppException {
  constructor(message = 'Recurso não encontrado') {
    super(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, message);
  }
}

/** 409 — conflito de estado/unicidade/agendamento. */
export class ConflictAppException extends AppException {
  constructor(message = 'Conflito de estado') {
    super(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message);
  }
}

/** 422 — regra de negócio impede a operação. */
export class BusinessRuleException extends AppException {
  constructor(message: string) {
    super(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.BUSINESS_RULE_VIOLATION, message);
  }
}
