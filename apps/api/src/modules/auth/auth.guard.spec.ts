import { randomBytes } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Role } from '@sirat/shared';
import type { EnvVars } from '../../config/env';
import { ACCESS_COOKIE, type AccessTokenService, type AuthUser } from './access-token.service';
import { AuthController } from './auth.controller';
import { Public, Roles, TWO_FACTOR_OPTIONAL, TwoFactorOptional } from './auth.decorators';
import { AuthGuard } from './auth.guard';
import { TwoFactorAdminController, TwoFactorController } from './two-factor/two-factor.controller';
import { TwoFactorConfig } from './two-factor/two-factor.config';

/* The global guard's two-factor rule (DECISIONS "Admin two-factor login"), without HTTP: a token is "verified" by a fake. */

class Routes {
  @Roles('admin')
  adminOnly() {}
  @Roles('admin', 'manager')
  staff() {}
  @Roles('student', 'ambassador', 'admin')
  mixed() {}
  @Roles('student')
  studentOnly() {}
  @Roles('admin', 'manager')
  @TwoFactorOptional()
  enrol() {}
  signedIn() {}
  @Public()
  open() {}
}

function config(key: boolean): TwoFactorConfig {
  const env: Partial<EnvVars> = key ? { TOTP_ENCRYPTION_KEY: randomBytes(32).toString('hex') } : {};
  return new TwoFactorConfig({
    get: (name: keyof EnvVars) => env[name],
  } as unknown as ConfigService<EnvVars, true>);
}

function guardFor(user: AuthUser | null, twoFactorOn = true) {
  const tokens = { verify: jest.fn(async () => user) } as unknown as AccessTokenService;
  return new AuthGuard(new Reflector(), tokens, config(twoFactorOn));
}

function ctx(handler: keyof Routes): ExecutionContext {
  const req = { cookies: { [ACCESS_COOKIE]: 'a-token' } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
  } as unknown as ExecutionContext;
}

const user = (role: Role, twoFactor: boolean): AuthUser => ({
  id: 'u-1',
  role,
  sessionId: 's-1',
  twoFactor,
});

async function outcome(guard: AuthGuard, handler: keyof Routes): Promise<string> {
  try {
    await guard.canActivate(ctx(handler));
    return 'allowed';
  } catch (e) {
    if (!(e instanceof HttpException)) throw e;
    const body = e.getResponse() as { code?: string };
    return `${e.getStatus()}${body.code ? ` ${body.code}` : ''}`;
  }
}

describe('AuthGuard: two-factor login', () => {
  it('refuses an admin or manager session without the claim on routes that name admin or manager (403 TWO_FACTOR_REQUIRED)', async () => {
    for (const role of ['admin', 'manager'] as const) {
      const guard = guardFor(user(role, false));
      expect(await outcome(guard, 'staff')).toBe('403 TWO_FACTOR_REQUIRED');
    }
    expect(await outcome(guardFor(user('admin', false)), 'adminOnly')).toBe(
      '403 TWO_FACTOR_REQUIRED',
    );
    expect(await outcome(guardFor(user('admin', false)), 'mixed')).toBe('403 TWO_FACTOR_REQUIRED');
  });

  it('lets the same sessions through once they proved the code', async () => {
    expect(await outcome(guardFor(user('admin', true)), 'adminOnly')).toBe('allowed');
    expect(await outcome(guardFor(user('manager', true)), 'staff')).toBe('allowed');
    expect(await outcome(guardFor(user('admin', true)), 'mixed')).toBe('allowed');
  });

  it('lets an unverified admin reach @TwoFactorOptional routes (enrolment) and routes without @Roles', async () => {
    const guard = guardFor(user('admin', false));
    expect(await outcome(guard, 'enrol')).toBe('allowed');
    expect(await outcome(guard, 'signedIn')).toBe('allowed');
    expect(await outcome(guard, 'open')).toBe('allowed');
  });

  it('never asks other roles for a second factor, also on a route admins share', async () => {
    expect(await outcome(guardFor(user('student', false)), 'mixed')).toBe('allowed');
    expect(await outcome(guardFor(user('student', false)), 'studentOnly')).toBe('allowed');
    expect(await outcome(guardFor(user('jury', false)), 'signedIn')).toBe('allowed');
  });

  it('checks the role before the second factor: another role still gets the plain 403', async () => {
    expect(await outcome(guardFor(user('student', false)), 'staff')).toBe('403');
    await expect(guardFor(user('admin', true)).canActivate(ctx('studentOnly'))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guardFor(null).canActivate(ctx('staff'))).rejects.toThrow(UnauthorizedException);
  });

  it('enforces nothing while 2FA is off (no TOTP_ENCRYPTION_KEY)', async () => {
    for (const handler of ['adminOnly', 'staff', 'mixed'] as const)
      expect(await outcome(guardFor(user('admin', false), false), handler)).toBe('allowed');
  });
});

describe('@TwoFactorOptional()', () => {
  it('is on exactly the five enrolment routes of the auth module', () => {
    const marked: string[] = [];
    for (const controller of [AuthController, TwoFactorController, TwoFactorAdminController]) {
      const base = String(Reflect.getMetadata(PATH_METADATA, controller));
      const proto = controller.prototype as unknown as Record<string, object>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(TWO_FACTOR_OPTIONAL, handler) === true) {
          const path = String(Reflect.getMetadata(PATH_METADATA, handler));
          marked.push(
            [base, path]
              .flatMap((p) => p.split('/'))
              .filter(Boolean)
              .join('/'),
          );
        }
      }
    }
    expect(marked.sort()).toEqual(
      ['auth/2fa', 'auth/2fa/enable', 'auth/2fa/setup', 'auth/logout', 'auth/me'].sort(),
    );
  });
});
