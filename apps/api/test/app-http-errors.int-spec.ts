/**
 * Error answers of the real pipeline (configureApp + Express body-parser):
 * - Gate (A2.0): request bodies the parser rejects are client errors: 4xx with the standard JSON shape and a fixed
 *   message, never 500.
 * - A handler that runs too long answers 503 before nginx gives up (A2.1).
 * - Headers on every answer (DECISIONS "TLS behind Cloudflare"): Cache-Control no-store unless a route sets its
 *   own, and no HSTS from the API (nginx is the only source).
 */
import { Controller, Get, Header } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Public } from '../src/modules/auth/auth.decorators';

/** Test-only routes: `slow` takes 1 s, five times the request timeout used below; `cached` sets its own Cache-Control. */
@Public()
@Controller('__probe')
class SlowProbeController {
  @Get('slow')
  async slow(): Promise<{ ok: true }> {
    await new Promise((r) => setTimeout(r, 1_000));
    return { ok: true };
  }

  @Get('cached')
  @Header('Cache-Control', 'private, max-age=60')
  cached(): { ok: true } {
    return { ok: true };
  }
}

let app: NestExpressApplication;
let base: string;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [SlowProbeController],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, { requestTimeoutMs: 200 });
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
}, 60_000);

afterAll(async () => {
  await app?.close();
});

const post = (body: string, contentType: string) =>
  fetch(`${base}/api/ready`, { method: 'POST', headers: { 'Content-Type': contentType }, body });

describe('body-parser errors answer 4xx JSON, never 500', () => {
  it('413 for a JSON body over the size limit', async () => {
    const res = await post(JSON.stringify({ blob: 'x'.repeat(200_000) }), 'application/json');
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Payload too large',
    });
  });

  it('400 for malformed JSON, without echoing the body back', async () => {
    const res = await post('{"password": "hunter2-secret", ', 'application/json');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
    expect(JSON.stringify(body)).not.toContain('hunter2-secret');
  });

  it('415 for an unsupported charset', async () => {
    // The JSON parser only accepts utf-* charsets (utf-7 would be accepted).
    const res = await post('{}', 'application/json; charset=latin1');
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ statusCode: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });
});

describe('request timeout (below nginx proxy_read_timeout)', () => {
  it('answers 503 JSON when a handler runs past the limit', async () => {
    const started = Date.now();
    const res = await fetch(`${base}/api/__probe/slow`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Request timed out',
    });
    expect(Date.now() - started).toBeLessThan(900);
  });
});

describe('headers on every answer', () => {
  it('sends Cache-Control: no-store and no HSTS, on success and on errors', async () => {
    for (const path of ['/api/health', '/api/no-such-route']) {
      const res = await fetch(`${base}${path}`);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('strict-transport-security')).toBeNull();
      expect(res.headers.get('x-content-type-options')).toBe('nosniff'); // helmet still runs
    }
  });

  it('keeps a Cache-Control that a route sets itself', async () => {
    const res = await fetch(`${base}/api/__probe/cached`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });
});
