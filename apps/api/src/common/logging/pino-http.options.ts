import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';

/** Accept an incoming id (nginx sends its own `$request_id`) only if it is short and plain; otherwise make one. */
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Path only: query strings can carry tokens (reset/verify links) and personal data (emails). */
export function pathOnly(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-ID', id);
  return id;
}

type SerializedReq = { id?: unknown; method?: string; url?: string };
type SerializedRes = { statusCode?: number };

/**
 * Request logging (A2.0 gate 2): method, path without query, status and request id only. Never headers (cookies,
 * CSRF tokens, authorization), query strings, bodies or client IPs. nginx keeps the access log with IPs.
 */
export function pinoHttpOptions(env: NodeJS.ProcessEnv = process.env): Options {
  return {
    level: env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
    genReqId: requestId,
    serializers: {
      // pino-http passes the already-serialised request/response; keep only the safe fields.
      req: (req: SerializedReq) => ({ id: req.id, method: req.method, url: pathOnly(req.url) }),
      res: (res: SerializedRes) => ({ statusCode: res.statusCode }),
    },
    // Container healthchecks hit /api/health every few seconds per replica.
    autoLogging: { ignore: (req: IncomingMessage) => pathOnly(req.url) === '/api/health' },
    // Backstop in case a future serializer change brings headers back.
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
    ],
  };
}
