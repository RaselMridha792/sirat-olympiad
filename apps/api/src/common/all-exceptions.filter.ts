import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError } from '@sirat/shared';

/**
 * Errors raised by body-parser / raw-body (the `http-errors` shape): client mistakes such as a body over the
 * size limit, malformed JSON or an unsupported charset. They are not HttpExceptions, so without this branch
 * they became 500 + an error log.
 */
type ClientHttpError = { status?: number; statusCode?: number; expose?: boolean; type?: string };

/** Fixed messages: never echo the parser's own message, which can quote the request body. */
const CLIENT_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  400: 'Bad request',
  413: 'Payload too large',
  415: 'Unsupported media type',
};

/** An application error code an HttpException may carry in its body (`{ code, message }`), e.g. EMAIL_REGISTERED. */
const APP_CODE = /^[A-Z][A-Z0-9_]{2,40}$/;

/** Only these Prisma `meta` keys are logged: they name the model/constraint/column, never values. */
const SAFE_PRISMA_META_KEYS = ['modelName', 'target', 'constraint', 'field_name'] as const;

export function isClientHttpError(e: unknown): e is ClientHttpError {
  if (!e || typeof e !== 'object') return false;
  const { status, statusCode, expose } = e as ClientHttpError;
  const code = status ?? statusCode;
  return expose === true && typeof code === 'number' && code >= 400 && code < 500;
}

/**
 * What may be logged about an unexpected error. Never the message: Prisma messages contain every query argument
 * (emails, phones, password hashes), and other messages can quote user input. Prisma errors: class name, code and
 * the names of the model/constraint/columns. Anything else: class name and stack frames without the message line.
 */
export function errorLogFields(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { errName: typeof e };
  if (e.name.startsWith('PrismaClient')) {
    const { code, meta } = e as Error & { code?: unknown; meta?: Record<string, unknown> };
    const safeMeta: Record<string, unknown> = {};
    for (const key of SAFE_PRISMA_META_KEYS) if (meta && key in meta) safeMeta[key] = meta[key];
    return { errName: e.name, code, meta: safeMeta };
  }
  const stack = e.stack ?? '';
  const framesStart = stack.indexOf('\n    at ');
  return { errName: e.name, frames: framesStart >= 0 ? stack.slice(framesStart + 1) : undefined };
}

/** One consistent error shape; never leaks stack traces, raw DB errors, or anything sensitive into logs. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: unknown }>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: unknown;
    let appCode: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; error?: string; code?: unknown };
        message = Array.isArray(b.message) ? 'Validation failed' : (b.message ?? message);
        if (Array.isArray(b.message)) details = b.message;
        // A machine code a service set on purpose (e.g. EMAIL_REGISTERED), so the web can pick a bn/en text.
        if (typeof b.code === 'string' && APP_CODE.test(b.code)) appCode = b.code;
      }
    } else if (isClientHttpError(exception)) {
      status = exception.status ?? exception.statusCode ?? HttpStatus.BAD_REQUEST;
      message = CLIENT_ERROR_MESSAGES[status] ?? 'Bad request';
      this.logger.warn({
        msg: 'rejected request',
        type: exception.type,
        method: req.method,
        path: req.path,
        status,
      });
    } else {
      this.logger.error({
        msg: 'unhandled error',
        ...errorLogFields(exception),
        method: req.method,
        path: req.path,
      });
    }

    const payload: ApiError = {
      statusCode: status,
      code: appCode ?? HttpStatus[status] ?? 'ERROR',
      message,
      requestId: req.id === undefined ? undefined : String(req.id),
      details,
    };
    res.status(status).json(payload);
  }
}
