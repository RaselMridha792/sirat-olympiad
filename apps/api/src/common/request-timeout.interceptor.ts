import {
  CallHandler,
  ExecutionContext,
  Logger,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

/** Below nginx's proxy_read_timeout (30 s), so the client gets our JSON error instead of a gateway timeout. */
export const REQUEST_TIMEOUT_MS = 25_000;

/**
 * Answers 503 when a handler (with its pipes) has not finished in time. The handler itself cannot be cancelled,
 * but every database statement it runs is bounded by statement_timeout (10 s, a database default).
 */
export class RequestTimeoutInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestTimeoutInterceptor.name);

  constructor(private readonly ms: number = REQUEST_TIMEOUT_MS) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.ms),
      catchError((err: unknown) => {
        if (!(err instanceof TimeoutError)) return throwError(() => err);
        const req = context.switchToHttp().getRequest<Request>();
        this.logger.warn({
          msg: 'request timed out',
          method: req.method,
          path: req.path,
          ms: this.ms,
        });
        return throwError(() => new ServiceUnavailableException('Request timed out'));
      }),
    );
  }
}
