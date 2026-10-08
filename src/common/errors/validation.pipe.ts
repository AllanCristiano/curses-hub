import { ValidationError, ValidationPipe } from '@nestjs/common';
import { ErrorDetail } from './error-codes';
import { ValidationFailedException } from './app.exceptions';

function flatten(errors: ValidationError[], parent = ''): ErrorDetail[] {
  return errors.flatMap((err) => {
    const field = parent ? `${parent}.${err.property}` : err.property;
    const own = Object.values(err.constraints ?? {}).map((message) => ({ field, message }));
    const children = err.children?.length ? flatten(err.children, field) : [];
    return [...own, ...children];
  });
}

/** ValidationPipe global: whitelist + transformação + contrato de erro da seção 10. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new ValidationFailedException('Dados inválidos', flatten(errors)),
  });
}
