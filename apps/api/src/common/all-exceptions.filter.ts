import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError } from '@sirat/shared';

/** One consistent error shape; never leaks stack traces or raw DB errors. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; error?: string };
        message = Array.isArray(b.message) ? 'Validation failed' : (b.message ?? message);
        if (Array.isArray(b.message)) details = b.message;
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.message : 'Unknown error');
    }

    const payload: ApiError = {
      statusCode: status,
      code: HttpStatus[status] ?? 'ERROR',
      message,
      requestId: (req.headers['x-request-id'] as string | undefined) ?? undefined,
      details,
    };
    res.status(status).json(payload);
  }
}
