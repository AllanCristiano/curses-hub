import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ulid } from 'ulid';

/** Gera/propaga o requestId (ULID) usado em logs e respostas de erro. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
    const incoming = req.header('x-request-id');
    const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : ulid();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  }
}
