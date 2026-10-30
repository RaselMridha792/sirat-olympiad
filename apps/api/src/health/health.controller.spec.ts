import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController, READY_TIMEOUT_MS } from './health.controller';

type FakeRedis = { status: string; ping: jest.Mock; connect: jest.Mock };
const redis = (status = 'ready', ping: () => Promise<string> = () => Promise.resolve('PONG')): FakeRedis => ({
  status,
  ping: jest.fn(ping),
  connect: jest.fn(() => Promise.resolve()),
});
const db = (impl: () => Promise<unknown>) => ({ $queryRaw: impl }) as never;
const make = (database: () => Promise<unknown>, cache: FakeRedis = redis(), queue: FakeRedis = redis()) =>
  new HealthController(db(database), cache as never, queue as never);
const dbOk = () => Promise.resolve([1]);

describe('HealthController', () => {
  afterEach(() => jest.useRealTimers());

  it('liveness returns ok without touching dependencies', () => {
    const c = new HealthController({} as never, {} as never, {} as never);
    expect(c.health()).toEqual({ status: 'ok' });
  });

  it('is ready when database and both Redis instances answer', async () => {
    await expect(make(dbOk).ready()).resolves.toEqual({ status: 'ready' });
  });

  it('is not ready when the queue Redis is down (jobs must not be lost)', async () => {
    const down = redis('ready', () => Promise.reject(new Error('ECONNREFUSED')));
    await expect(make(dbOk, redis(), down).ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is not ready when the database is down', async () => {
    await expect(make(() => Promise.reject(new Error('db down'))).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('does not queue a PING on a disconnected client, it answers 503 at once', async () => {
    const reconnecting = redis('reconnecting');
    await expect(make(dbOk, redis(), reconnecting).ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(reconnecting.ping).not.toHaveBeenCalled();
  });

  it('shares one in-flight PING between concurrent probes', async () => {
    let release: (v: string) => void = () => undefined;
    const slow = redis('ready', () => new Promise<string>((r) => (release = r)));
    const c = make(dbOk, slow);
    const both = Promise.all([c.ready(), c.ready()]);
    release('PONG');
    await expect(both).resolves.toEqual([{ status: 'ready' }, { status: 'ready' }]);
    expect(slow.ping).toHaveBeenCalledTimes(1);
  });

  it('answers 503 within the timeout when a dependency hangs instead of hanging itself', async () => {
    jest.useFakeTimers();
    const hang = redis('ready', () => new Promise<string>(() => undefined));
    const result = make(dbOk, hang).ready();
    const assertion = expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await assertion;
  });
});
