import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { AppException } from './app.exceptions';
import { ErrorCode, ErrorDetail, ErrorResponseBody } from './error-codes';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.AUTHENTICATION_REQUIRED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.RESOURCE_NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.BUSINESS_RULE_VIOLATION,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
};

/** Detecta violação da constraint de exclusão do PostgreSQL (sobreposição de agendamentos). */
export function isExclusionViolation(exception: unknown): boolean {
  if (!exception || typeof exception !== 'object') return false;
  let text: string;
  try {
    text = JSON.stringify(exception, Object.getOwnPropertyNames(exception));
  } catch {
    text = String(exception);
  }
  return text.includes('23P01') || text.includes('appointments_no_overlap_excl');
}

/**
 * Filtro global: garante o contrato de erro previsível da seção 10 e
 * nunca vaza stack trace ou detalhes internos.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();

    const body = this.toBody(exception);
    body.requestId = req.requestId;

    if (body.statusCode >= 500) {
      this.logger.error(
        JSON.stringify({
          message: 'Unhandled exception',
          requestId: req.requestId,
          method: req.method,
          path: req.originalUrl,
          error: exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      );
    }

    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorResponseBody {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.getStatus(),
        error: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      let message = exception.message;
      let details: ErrorDetail[] | undefined;
      if (typeof response === 'object' && response !== null) {
        const r = response as { message?: string | string[] };
        if (Array.isArray(r.message)) {
          details = r.message.map((m) => ({ message: m }));
          message = 'Dados inválidos';
        } else if (typeof r.message === 'string') {
          message = r.message;
        }
      }
      return {
        statusCode: status,
        error: STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL_ERROR,
        message,
        ...(details ? { details } : {}),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          statusCode: HttpStatus.CONFLICT,
          error: ErrorCode.CONFLICT,
          message: 'Registro duplicado',
        };
      }
      if (exception.code === 'P2025') {
        return {
          statusCode: HttpStatus.NOT_FOUND,
          error: ErrorCode.RESOURCE_NOT_FOUND,
          message: 'Recurso não encontrado',
        };
      }
    }

    if (isExclusionViolation(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        error: ErrorCode.CONFLICT,
        message: 'Horário indisponível',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: ErrorCode.INTERNAL_ERROR,
      message: 'Erro interno do servidor',
    };
  }
}
