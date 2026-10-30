/**
 * SIGTERM drain behind keep-alive (nginx upstream keepalive): the shutdown must finish even while a client keeps
 * its connection busy, because responses during the drain carry `Connection: close`. Without that, Node's
 * server.close() waits forever and the pools are never closed before Docker kills the process.
 */
import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A deliberately slow route keeps the single keep-alive connection busy at the moment shutdown starts.
@Controller('drain-test')
class SlowController {
  @Get('slow')
  async slow(): Promise<{ ok: true }> {
    await sleep(300);
    return { ok: true };
  }
}

let app: NestExpressApplication;
let port: number;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const { REDIS_CACHE } = await import('../src/redis/redis.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [SlowController],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app); // the production pipeline (main.ts), drain middleware first
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
  const cache = app.get<Redis>(REDIS_CACHE);
  if (cache.status !== 'ready') await new Promise((r) => cache.once('ready', r));
}, 60_000);

it('finishes shutdown while a keep-alive client keeps its connection busy', async () => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const connectionHeaders: string[] = [];
  let stop = false;
  const request = () =>
    new Promise<boolean>((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/drain-test/slow', agent },
        (res) => {
          connectionHeaders.push(String(res.headers.connection));
          res.resume();
          res.on('end', () => resolve(true));
        },
      );
      req.on('error', () => resolve(false)); // the listener is closed once the drain started
    });
  const client = (async () => {
    // Back-to-back requests on one socket, like nginx reusing a busy upstream connection.
    while (!stop && (await request())) {
      /* next request immediately */
    }
  })();

  await sleep(450); // first request done, second one in flight: the connection is busy right now
  const started = Date.now();
  const outcome = await Promise.race([
    app.close().then(() => 'closed'),
    sleep(8_000).then(() => 'hung'),
  ]);
  const took = Date.now() - started;
  stop = true;
  if (outcome === 'hung') app.getHttpServer().closeAllConnections(); // clean up a failing run
  await client;
  agent.destroy();

  expect(outcome).toBe('closed');
  expect(took).toBeLessThan(3_000); // the in-flight request (<= 300 ms) finishes, then the server closes
  expect(connectionHeaders).toContain('close'); // the response during the drain told the client to hang up
}, 30_000);
