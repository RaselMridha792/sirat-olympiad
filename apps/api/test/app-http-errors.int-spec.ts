/**
 * Gate (A2.0): request bodies the parser rejects are client errors. Through the real pipeline (configureApp +
 * Express body-parser) they answer 4xx with the standard JSON shape and a fixed message, never 500.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

let app: NestExpressApplication;
let base: string;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
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
