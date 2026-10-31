import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Throttle, type ThrottlerModuleOptions, type ThrottlerStorage } from '@nestjs/throttler';
import type { EnvVars } from '../../config/env';
import type { AccessTokenService, AuthUser } from '../../modules/auth/access-token.service';
import { UserOrIpThrottlerGuard } from './user-or-ip-throttler.guard';

const student: AuthUser = { id: 'u-1', role: 'student', sessionId: 's-1' };

class Routes {
  open() {}
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  tiered() {}
}

async function setup() {
  const increments: { key: string; limit: number }[] = [];
  const storage: ThrottlerStorage = {
    increment: jest.fn(async (key: string, ttl: number, limit: number) => {
      increments.push({ key, limit });
      return { totalHits: 1, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0 };
    }),
  };
  const verify = jest.fn(async (token: string) => (token === 'valid' ? student : null));
  const options: ThrottlerModuleOptions = {
    throttlers: [{ name: 'default', ttl: 60_000, limit: 600 }],
    generateKey: (_context, tracker) => tracker, // the storage key is the tracker itself, to read it back
  };
  const guard = new UserOrIpThrottlerGuard(
    options,
    storage,
    new Reflector(),
    { verify } as unknown as AccessTokenService,
    { get: () => 120 } as unknown as ConfigService<EnvVars, true>,
  );
  await guard.onModuleInit();
  return { guard, increments, verify };
}

function contextFor(handler: keyof Routes, cookie?: string, ip = '203.0.113.7'): ExecutionContext {
  const req = { ip, cookies: cookie === undefined ? {} : { sirat_access: cookie }, headers: {} };
  const res = { header: jest.fn(), setHeader: jest.fn() };
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

describe('UserOrIpThrottlerGuard', () => {
  it('counts a verified session against its user, with the per-user limit', async () => {
    const { guard, increments } = await setup();
    await guard.canActivate(contextFor('open', 'valid'));
    expect(increments).toEqual([{ key: 'user:u-1', limit: 120 }]);
  });

  it('counts a missing, forged or expired token against the client IP, with the per-IP limit', async () => {
    const { guard, increments } = await setup();
    await guard.canActivate(contextFor('open'));
    await guard.canActivate(contextFor('open', 'forged-or-expired'));
    await guard.canActivate(contextFor('open', ''));
    expect(increments).toEqual([
      { key: 'ip:203.0.113.7', limit: 600 },
      { key: 'ip:203.0.113.7', limit: 600 },
      { key: 'ip:203.0.113.7', limit: 600 },
    ]);
  });

  it("keeps a route's own tier, whoever asks", async () => {
    const { guard, increments } = await setup();
    await guard.canActivate(contextFor('tiered', 'valid'));
    await guard.canActivate(contextFor('tiered'));
    expect(increments.map((i) => i.limit)).toEqual([300, 300]);
    expect(increments.map((i) => i.key)).toEqual(['user:u-1', 'ip:203.0.113.7']);
  });

  it('checks the signature once per request, for the limit and the key together', async () => {
    const { guard, verify } = await setup();
    await guard.canActivate(contextFor('open', 'valid'));
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("keeps the library's IPv6 grouping for the IP key", async () => {
    const { guard, increments } = await setup();
    await guard.canActivate(contextFor('open', undefined, '2001:db8:abcd:12ff::1'));
    await guard.canActivate(contextFor('open', undefined, '2001:db8:abcd:12ff::2'));
    expect(increments[0]?.key).toMatch(/^ip:/);
    expect(increments[0]?.key).toBe(increments[1]?.key); // one /64 subnet, one key
  });
});
