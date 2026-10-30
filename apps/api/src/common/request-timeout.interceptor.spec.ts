import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NEVER, firstValueFrom, map, throwError, timer } from 'rxjs';
import { REQUEST_TIMEOUT_MS, RequestTimeoutInterceptor } from './request-timeout.interceptor';

const context = {
  switchToHttp: () => ({ getRequest: () => ({ method: 'POST', path: '/api/attempts/1/submit' }) }),
} as unknown as ExecutionContext;
const handler = (source: CallHandler['handle']): CallHandler => ({ handle: source });

describe('RequestTimeoutInterceptor', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('passes a response that arrives in time through unchanged', async () => {
    const out = new RequestTimeoutInterceptor(200).intercept(
      context,
      handler(() => timer(10).pipe(map(() => ({ ok: true })))),
    );
    await expect(firstValueFrom(out)).resolves.toEqual({ ok: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers 503 once the handler runs past the limit, and logs method and path only', async () => {
    const started = Date.now();
    const out = new RequestTimeoutInterceptor(50).intercept(
      context,
      handler(() => NEVER),
    );
    await expect(firstValueFrom(out)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    expect(warn).toHaveBeenCalledWith({
      msg: 'request timed out',
      method: 'POST',
      path: '/api/attempts/1/submit',
      ms: 50,
    });
  });

  it('leaves other errors from the handler untouched', async () => {
    const error = new BadRequestException('nope');
    const out = new RequestTimeoutInterceptor(200).intercept(
      context,
      handler(() => throwError(() => error)),
    );
    await expect(firstValueFrom(out)).rejects.toBe(error);
    expect(warn).not.toHaveBeenCalled();
  });

  it('defaults to 25 s, below nginx proxy_read_timeout (30 s)', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(25_000);
    const interceptor = new RequestTimeoutInterceptor();
    expect((interceptor as unknown as { ms: number }).ms).toBe(REQUEST_TIMEOUT_MS);
  });
});
