import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/** Log estruturado (JSON) por requisição. Nunca registra corpo, senhas ou tokens. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.log(req, res.statusCode, started),
        error: (err) => this.log(req, err?.getStatus?.() ?? 500, started),
      }),
    );
  }

  private log(req: any, status: number, started: number) {
    this.logger.log(
      JSON.stringify({
        requestId: req.requestId,
        method: req.method,
        path: (req.originalUrl as string)?.split('?')[0],
        status,
        durationMs: Date.now() - started,
        userId: req.user?.id,
        organizationId: req.tenant?.organizationId,
      }),
    );
  }
}
