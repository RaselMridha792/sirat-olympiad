import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController, READY_CACHE_MS, READY_TIMEOUT_MS } from './health.controller';

type FakeRedis = { status: string; ping: jest.Mock; connect: jest.Mock };
const redis = (
  status = 'ready',
  ping: () => Promise<string> = () => Promise.resolve('PONG'),
): FakeRedis => ({
  status,
  ping: jest.fn(ping),
  connect: jest.fn(() => Promise.resolve()),
});
const db = (impl: () => Promise<unknown>) => ({ $queryRaw: impl }) as never;
const make = (
  database: () => Promise<unknown>,
  cache: FakeRedis = redis(),
  queue: FakeRedis = redis(),
) => new HealthController(db(database), cache as never, queue as never);
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
    await expect(make(dbOk, redis(), down).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('is not ready when the database is down', async () => {
    await expect(make(() => Promise.reject(new Error('db down'))).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('does not queue a PING on a disconnected client, it answers 503 at once', async () => {
    const reconnecting = redis('reconnecting');
    await expect(make(dbOk, redis(), reconnecting).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
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

  it('answers a second probe within the window from the same check: the database is asked once', async () => {
    const query = jest.fn(dbOk);
    const cache = redis();
    const c = make(query, cache);
    await expect(c.ready()).resolves.toEqual({ status: 'ready' });
    await expect(c.ready()).resolves.toEqual({ status: 'ready' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(cache.ping).toHaveBeenCalledTimes(1);
  });

  it('checks again once the window has passed', async () => {
    // Only the clock is fake: withTimeout's own timers stay real.
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'clearTimeout', 'nextTick'] });
    const query = jest.fn(dbOk);
    const c = make(query);
    await c.ready();
    jest.setSystemTime(Date.now() + READY_CACHE_MS - 1);
    await c.ready();
    expect(query).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + 1);
    await c.ready();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('keeps a failure for the window too, and concurrent probes share one check', async () => {
    const query = jest.fn(() => Promise.reject(new Error('db down')));
    const c = make(query);
    const both = Promise.allSettled([c.ready(), c.ready()]);
    expect((await both).map((r) => r.status)).toEqual(['rejected', 'rejected']);
    await expect(c.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('answers 503 within the timeout when a dependency hangs instead of hanging itself', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] }); // withTimeout defers its rejection with setImmediate
    const hang = redis('ready', () => new Promise<string>(() => undefined));
    const result = make(dbOk, hang).ready();
    const assertion = expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await assertion;
  });
});
