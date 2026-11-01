/**
 * Deny by default (RULEBOOK §5, 06-API): every route needs a valid session unless it is @Public(), and every public
 * route must be in the reviewed allow-list below. Boots the real AppModule and compares the routes Nest's controllers
 * declare with the routes Express actually serves, so a route registered outside a controller (and so outside the
 * guards) fails too. A probe controller then checks the guards' behaviour over HTTP.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { METHODS } from 'node:http';
import { Controller, Get, HttpCode, Post, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  ACCESS_COOKIE,
  AccessTokenService,
  accessTokenJwtOptions,
  type AuthUser,
} from '../src/modules/auth/access-token.service';
import {
  CurrentUser,
  IS_PUBLIC,
  Public,
  REQUIRED_ROLES,
  Roles,
  SKIP_CSRF,
  TWO_FACTOR_OPTIONAL,
} from '../src/modules/auth/auth.decorators';

/** Reviewed: 06-API "Public allow-list". A new entry here needs the owner's review. */
const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'GET /api/ready',
  'POST /api/auth/login',
  'POST /api/auth/refresh',
  'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password',
  'POST /api/auth/verify-email',
  'POST /api/auth/resend-verification',
  // The login's code step (DECISIONS "Admin two-factor login"): the sirat_2fa challenge cookie is the credential, like
  // the password before it; under the login limits.
  'POST /api/auth/2fa/verify',
  'POST /api/registrations/start',
  // Payments plan 6.7: before an account exists, the sirat_reg cookie is the only proof of "my attempt"; no route
  // takes an id, and none returns personal data.
  'GET /api/registrations/info',
  'GET /api/registrations/current',
  'POST /api/registrations/current/resume',
  'POST /api/registrations/current/retry',
  'POST /api/registrations/current/cancel',
  'POST /api/registrations/current/recheck', // payments PR 3: asks for a status check, at most once per 10 s
  // Payments PR 3 (plan 6.2, 6.4): PayStation's two signals. Neither is trusted; each only records and asks the worker
  // for a status check. The callback carries our invoice in the path (plan 6.7, "06-API changes").
  'GET /api/payments/paystation/callback/:invoice',
  'POST /api/payments/paystation/ipn',
  'GET /api/book/cover/:imageId', // the free book's cover image (plan 16.3): no personal data, cached a year
  'GET /api/content/*',
  'GET /api/certificates/verify/:code',
]);
/**
 * Reviewed (DECISIONS "Admin two-factor login"): the routes an admin or manager whose session has not proved a second
 * factor may use, so they can enrol. Any other route that names admin or manager answers 403 TWO_FACTOR_REQUIRED.
 */
const TWO_FACTOR_OPTIONAL_ROUTES = new Set([
  'GET /api/auth/me',
  'POST /api/auth/logout',
  'GET /api/auth/2fa',
  'POST /api/auth/2fa/setup',
  'POST /api/auth/2fa/enable',
]);
/** Reviewed: server-to-server callbacks that cannot send X-Requested-With. */
const CSRF_EXEMPT = new Set(['POST /api/payments/paystation/ipn']);

const PROBE = '/api/__probe/';

/** Test-only routes for the behaviour checks; excluded from the inventory. */
@Controller('__probe')
class GuardProbeController {
  @Get('private')
  whoami(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Post('private')
  @HttpCode(200)
  write(@CurrentUser() user: AuthUser): { ok: true; id: string } {
    return { ok: true, id: user.id };
  }

  @Roles('admin')
  @Get('admin')
  adminOnly(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @Get('public')
  open(@CurrentUser() user: AuthUser | undefined): { user: AuthUser | null } {
    return { user: user ?? null };
  }

  @Public()
  @Post('public')
  @HttpCode(200)
  openWrite(): { ok: true } {
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
    imports: [AppModule, DiscoveryModule],
    controllers: [GuardProbeController],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
}, 60_000);

afterAll(async () => {
  await app?.close();
});

interface DeclaredRoute {
  key: string;
  isPublic: boolean;
  roles: string[] | undefined;
  skipCsrf: boolean;
  twoFactorOptional: boolean;
}

const joinPath = (...parts: string[]) =>
  '/' +
  parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

/** Every route declared by a controller, with the metadata the global guards read. */
function declaredRoutes(): DeclaredRoute[] {
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const routes: DeclaredRoute[] = [];
  for (const { instance, metatype } of app.get(DiscoveryService).getControllers()) {
    if (!instance || !metatype) continue;
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    const bases = [Reflect.getMetadata(PATH_METADATA, metatype) ?? ''].flat() as string[];
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name] as (...args: unknown[]) => unknown;
      const paths = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (paths === undefined || method === undefined) continue;
      const targets = [handler, metatype];
      for (const b of bases)
        for (const p of [paths].flat())
          routes.push({
            key: `${RequestMethod[method]} ${joinPath('api', b, p)}`,
            isPublic: reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) === true,
            roles: reflector.getAllAndOverride<string[] | undefined>(REQUIRED_ROLES, targets),
            skipCsrf: reflector.getAllAndOverride<boolean>(SKIP_CSRF, targets) === true,
            twoFactorOptional:
              reflector.getAllAndOverride<boolean>(TWO_FACTOR_OPTIONAL, targets) === true,
          });
    }
  }
  return routes.filter((r) => !r.key.includes(PROBE));
}

type ExpressRouter = { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };

/**
 * Module middleware applied with forRoutes('*') (nestjs-pino's request logger) is registered by Nest as catch-all
 * routes on the global prefix, one per HTTP method. It only runs before the real handler and calls next(). A
 * controller route never looks like this: even @All() shows up as a single `_all` entry.
 */
const isModuleMiddleware = (path: string, methods: string[]) =>
  (path === '/api' || path === '/api/{*path}') &&
  METHODS.every((m) => methods.includes(m.toLowerCase()));

/** Every route Express serves, however it was registered (module middleware excluded, see above). */
function servedRoutes(): string[] {
  const express = app.getHttpAdapter().getInstance() as {
    router?: ExpressRouter;
    _router?: ExpressRouter;
  };
  const router = express.router ?? express._router;
  if (!router) throw new Error('Express router not found');
  return router.stack
    .flatMap(({ route }) => {
      if (!route) return [];
      const methods = Object.keys(route.methods);
      if (isModuleMiddleware(route.path, methods)) return [];
      return methods.map((m) => `${m === '_all' ? 'ALL' : m.toUpperCase()} ${route.path}`);
    })
    .filter((key) => !key.includes(PROBE));
}

describe('route inventory: deny by default', () => {
  it('serves only routes declared by controllers, so every route passes the global guards', () => {
    const declared = declaredRoutes().map((r) => r.key);
    expect(servedRoutes().sort()).toEqual(declared.sort());
    expect(declared).toEqual(expect.arrayContaining(['GET /api/health', 'GET /api/ready']));
  });

  it('opens only routes from the reviewed public allow-list', () => {
    const open = declaredRoutes().filter((r) => r.isPublic);
    expect(open.map((r) => r.key).filter((key) => !PUBLIC_ROUTES.has(key))).toEqual([]);
    expect(open.map((r) => r.key)).toEqual(
      expect.arrayContaining(['GET /api/health', 'GET /api/ready']),
    );
  });

  it('skips CSRF only for reviewed callbacks, and never mixes @Public() with @Roles()', () => {
    const routes = declaredRoutes();
    expect(routes.filter((r) => r.skipCsrf && !CSRF_EXEMPT.has(r.key)).map((r) => r.key)).toEqual(
      [],
    );
    expect(routes.filter((r) => r.isPublic && r.roles).map((r) => r.key)).toEqual([]);
  });

  it('lets an admin without a proved second factor reach exactly the reviewed enrolment routes', () => {
    const optional = declaredRoutes().filter((r) => r.twoFactorOptional);
    expect(optional.map((r) => r.key).sort()).toEqual([...TWO_FACTOR_OPTIONAL_ROUTES].sort());
    // None of them is public: the exemption only ever relaxes the second factor, never the session.
    expect(optional.filter((r) => r.isPublic).map((r) => r.key)).toEqual([]);
  });
});

const session = (role: AuthUser['role'] = 'student'): AuthUser => ({
  id: randomUUID(),
  role,
  sessionId: randomUUID(),
  twoFactor: false,
});
const cookieFor = async (user: AuthUser, service = app.get(AccessTokenService)) =>
  `${ACCESS_COOKIE}=${await service.sign(user)}`;

function call(
  path: string,
  opts: { method?: string; cookie?: string; csrf?: boolean; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.csrf) headers['x-requested-with'] = 'XMLHttpRequest';
  return fetch(`${base}${path}`, { method: opts.method ?? 'GET', headers });
}

describe('AuthGuard', () => {
  it('answers 401 without a session, in the standard error shape', async () => {
    const res = await call('/api/__probe/private');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('lets a valid session through and hands the handler only the verified user', async () => {
    const user = session();
    const res = await call('/api/__probe/private', { cookie: await cookieFor(user) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(user);
  });

  it('rejects a token signed with another secret, an expired token, and a bearer header', async () => {
    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const foreign = new AccessTokenService(
      new JwtService(accessTokenJwtOptions(randomBytes(32).toString('hex'), 900)),
    );
    const expired = new AccessTokenService(new JwtService(accessTokenJwtOptions(secret, -10)));
    for (const cookie of [
      await cookieFor(session('admin'), foreign),
      await cookieFor(session(), expired),
      `${ACCESS_COOKIE}=not-a-jwt`,
    ])
      expect((await call('/api/__probe/private', { cookie })).status).toBe(401);

    const token = await app.get(AccessTokenService).sign(session());
    const bearer = await call('/api/__probe/private', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bearer.status).toBe(401); // the httpOnly cookie is the only way in
  });

  it('enforces @Roles(): 403 for another role, 200 for the right one', async () => {
    const student = await call('/api/__probe/admin', { cookie: await cookieFor(session()) });
    expect(student.status).toBe(403);
    expect(await student.json()).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    const admin = await call('/api/__probe/admin', { cookie: await cookieFor(session('admin')) });
    expect(admin.status).toBe(200);
  });

  it('keeps @Public() routes open, and still attaches a valid session there', async () => {
    expect(await (await call('/api/__probe/public')).json()).toEqual({ user: null });
    const user = session();
    const res = await call('/api/__probe/public', { cookie: await cookieFor(user) });
    expect(await res.json()).toEqual({ user });
    expect((await call('/api/health')).status).toBe(200);
  });
});

describe('CsrfGuard', () => {
  it('refuses a state-changing request without X-Requested-With, even with a valid session', async () => {
    const cookie = await cookieFor(session());
    const res = await call('/api/__probe/private', { method: 'POST', cookie });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      statusCode: 403,
      message: 'Missing X-Requested-With header',
    });
    expect(
      (await call('/api/__probe/private', { method: 'POST', cookie, csrf: true })).status,
    ).toBe(200);
  });

  it('covers public routes too (login CSRF needs no cookie)', async () => {
    expect((await call('/api/__probe/public', { method: 'POST' })).status).toBe(403);
    expect((await call('/api/__probe/public', { method: 'POST', csrf: true })).status).toBe(200);
  });

  it('never answers a cross-origin preflight (no CORS), so other sites cannot send the header', async () => {
    const res = await call('/api/__probe/public', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-requested-with',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
