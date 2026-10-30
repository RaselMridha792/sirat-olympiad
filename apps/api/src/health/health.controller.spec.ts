import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController, READY_TIMEOUT_MS } from './health.controller';

const ok = { ping: () => Promise.resolve('PONG') };
const db = (impl: () => Promise<unknown>) => ({ $queryRaw: impl }) as never;
const make = (database: () => Promise<unknown>, cache = ok, queue = ok) =>
  new HealthController(db(database), cache as never, queue as never);

describe('HealthController', () => {
  afterEach(() => jest.useRealTimers());

  it('liveness returns ok without touching dependencies', () => {
    const c = new HealthController({} as never, {} as never, {} as never);
    expect(c.health()).toEqual({ status: 'ok' });
  });

  it('is ready when database and both Redis instances answer', async () => {
    await expect(make(() => Promise.resolve([1])).ready()).resolves.toEqual({ status: 'ready' });
  });

  it('is not ready when the queue Redis is down (jobs must not be lost)', async () => {
    const down = { ping: () => Promise.reject(new Error('ECONNREFUSED')) };
    await expect(make(() => Promise.resolve([1]), ok, down).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('is not ready when the database is down', async () => {
    await expect(make(() => Promise.reject(new Error('db down'))).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('answers 503 within the timeout when a dependency hangs instead of hanging itself', async () => {
    jest.useFakeTimers();
    const hang = { ping: () => new Promise<string>(() => undefined) };
    const result = make(() => Promise.resolve([1]), hang).ready();
    const assertion = expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    await assertion;
  });
});
