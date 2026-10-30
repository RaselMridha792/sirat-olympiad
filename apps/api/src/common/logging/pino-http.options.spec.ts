import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import pinoHttp from 'pino-http';
import { pathOnly, pinoHttpOptions, requestId } from './pino-http.options';

const SECRET_TOKEN = 'reset-token-SECRET123';
const EMAIL = 'student1@example.com';

/** Runs one request through real pino-http with our options and returns the parsed log lines. */
async function logLinesFor(
  path: string,
  headers: Record<string, string>,
): Promise<Array<Record<string, unknown>>> {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      done();
    },
  });
  const middleware = pinoHttp({ ...pinoHttpOptions({ NODE_ENV: 'production' }) }, sink);
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    middleware(req, res);
    res.statusCode = 204;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  await new Promise<void>((r) => server.close(() => r()));
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('request logging (A2.0 gate 2)', () => {
  it('logs method, path, status and request id, never the query string or headers', async () => {
    const [line] = await logLinesFor(`/api/auth/reset?token=${SECRET_TOKEN}&email=${EMAIL}`, {
      Cookie: 'sirat_at=SESSIONCOOKIE',
      Authorization: 'Bearer BEARERTOKEN',
      'X-CSRF-Token': 'CSRFTOKEN',
      'X-Request-ID': 'abcd1234-from-nginx',
    });
    expect(line).toBeDefined();
    expect(line?.req).toEqual({ id: 'abcd1234-from-nginx', method: 'GET', url: '/api/auth/reset' });
    expect(line?.res).toEqual({ statusCode: 204 });
    const raw = JSON.stringify(line);
    for (const secret of [SECRET_TOKEN, EMAIL, 'SESSIONCOOKIE', 'BEARERTOKEN', 'CSRFTOKEN']) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).not.toContain('remoteAddress');
  });

  it('does not log the liveness probe', async () => {
    expect(await logLinesFor('/api/health', {})).toEqual([]);
    expect(await logLinesFor('/api/health?probe=1', {})).toEqual([]);
  });

  it('keeps a plain incoming request id and replaces anything else', () => {
    const res = { setHeader: jest.fn() } as unknown as ServerResponse;
    const req = (id?: string) =>
      ({ headers: id === undefined ? {} : { 'x-request-id': id } }) as IncomingMessage;

    expect(requestId(req('0123456789abcdef0123456789abcdef'), res)).toBe(
      '0123456789abcdef0123456789abcdef',
    );
    for (const bad of [
      'short',
      'x'.repeat(65),
      'has space id',
      'line\nbreak-injection',
      undefined,
    ]) {
      const id = requestId(req(bad), res);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', expect.any(String));
  });

  it('defaults to info in production, debug elsewhere, and honours LOG_LEVEL', () => {
    expect(pinoHttpOptions({ NODE_ENV: 'production' }).level).toBe('info');
    expect(pinoHttpOptions({ NODE_ENV: 'development' }).level).toBe('debug');
    expect(pinoHttpOptions({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }).level).toBe('warn');
  });

  it('pathOnly strips the query string', () => {
    expect(pathOnly('/a/b?x=1&y=2')).toBe('/a/b');
    expect(pathOnly(undefined)).toBe('');
  });
});
