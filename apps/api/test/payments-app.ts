import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient, Role } from '@prisma/client';
import { EDUCATION_TYPES } from '@sirat/shared';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { seedConfig } from '../prisma/seed';
import { AuditService } from '../src/modules/audit/audit.service';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { SessionService } from '../src/modules/auth/session.service';
import { PAYMENT_GATEWAY } from '../src/modules/payments/gateway/payment-gateway';
import { PAYMENT_CONFIG } from '../src/modules/payments/payments-boot-check';
import { PaymentReconciler } from '../src/modules/payments/verify/payment-reconciler';
import { PaymentQueue } from '../src/modules/payments/verify/payment-queue';
import { PaymentSettlement } from '../src/modules/payments/verify/payment-settlement';
import { PaymentVerifier } from '../src/modules/payments/verify/payment-verifier';
import { PrismaService } from '../src/prisma/prisma.service';
import { QUEUE_REDIS_OPTIONS } from '../src/redis/redis.module';
import { startFakePaystation, type FakePaystation } from './fake-paystation/fake-paystation';
import { applyReferenceData, makeUser, testPhone, testPrisma, truncateAll } from './helpers';

/*
 * Shared setup for the payments PR 3 tests: the real AppModule against the *_test database and the fake PayStation,
 * plus the worker's verifier and reconciler built from the app's own providers (like exam-results.int-spec builds
 * ExamJobs), so a test runs a verify job exactly when it wants to. Queue jobs land on the test queue Redis (this
 * worktree's DB), where no worker runs; tests read them by job id and clear the queue.
 */

export const PASSWORD = 'Blue-river-moon-42';
export const APP_ORIGIN = 'http://app.test.invalid';

export interface PaymentsApp {
  app: NestExpressApplication;
  base: string;
  prisma: PrismaClient;
  fake: FakePaystation;
  /** Set `ipnUrl` to make the fake post its IPN to the app. */
  fakeOptions: { ipnUrl?: string };
  cache: Redis;
  /** This run's own payments queue (PAYMENTS_QUEUE_NAME), so no worker running elsewhere takes its jobs. */
  queueName: string;
  queue: Queue;
  queueRedis: Redis;
  verifier: PaymentVerifier;
  reconciler: PaymentReconciler;
  gradeLevelId: string;
  sessions: SessionService;
  close(): Promise<void>;
}

export async function bootPaymentsApp(): Promise<PaymentsApp> {
  // Closed in reverse order by close(), or right away when the boot fails (e.g. the app does not compile), so a
  // failed boot cannot leave the fake server or a Redis connection holding jest open.
  const opened: (() => unknown)[] = [];
  const closeAll = async () => {
    for (const step of opened.reverse())
      await Promise.resolve()
        .then(step)
        .catch(() => undefined);
  };
  try {
    const fakeOptions: { ipnUrl?: string } = {};
    const queueName = `payments-test-${randomUUID().slice(0, 8)}`;
    const fake = await startFakePaystation(fakeOptions);
    opened.push(() => fake.close());
    Object.assign(process.env, {
      LOG_LEVEL: 'silent',
      APP_URL: APP_ORIGIN,
      PAYSTATION_ENV: 'fake',
      PAYSTATION_BASE_URL: fake.url,
      PAYSTATION_MERCHANT_ID: '',
      PAYSTATION_PASSWORD: '',
      PAYSTATION_ACCOUNT_LABEL: 'test-fake',
      PAYSTATION_INVOICE_PREFIX: 'T',
      PAYSTATION_CALLBACK_URL: 'http://localhost:4100/api/payments/paystation/callback',
      PAYSTATION_IPN_URL: '',
      PAYSTATION_PAY_WITH_CHARGE: '0',
      PAYMENTS_QUEUE_NAME: queueName,
    });
    const prisma = testPrisma();
    opened.push(() => prisma.$disconnect());
    const gradeLevelId = await resetData(prisma);
    const cache = new Redis(process.env.REDIS_CACHE_URL as string, { maxRetriesPerRequest: 1 });
    opened.push(() => cache.disconnect());
    opened.push(() => clearCache(cache));
    await clearCache(cache);
    const queueRedis = new Redis(process.env.REDIS_QUEUE_URL as string, {
      ...QUEUE_REDIS_OPTIONS,
    });
    opened.push(() => queueRedis.disconnect());
    const queue = new Queue(queueName, { connection: queueRedis });
    opened.push(() => queue.close());
    opened.push(() => queue.obliterate({ force: true }));
    await queue.obliterate({ force: true });

    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/configure-app');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    opened.push(() => app.close());
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');

    const appPrisma = app.get(PrismaService);
    const config = app.get(PAYMENT_CONFIG);
    const verifier = new PaymentVerifier(
      appPrisma,
      config,
      app.get(PAYMENT_GATEWAY),
      app.get(PaymentSettlement),
      app.get(AuditService),
    );
    const reconciler = new PaymentReconciler(appPrisma, config, app.get(PaymentQueue));
    return {
      app,
      base,
      prisma,
      fake,
      fakeOptions,
      cache,
      queueName,
      queue,
      queueRedis,
      verifier,
      reconciler,
      gradeLevelId,
      sessions: app.get(SessionService),
      close: closeAll,
    };
  } catch (e) {
    await closeAll();
    throw e;
  }
}

/** Empty tables, the reference data and the config seed, with registration open. Returns a grade level's new id. */
export async function resetData(prisma: PrismaClient): Promise<string> {
  await truncateAll(prisma);
  await applyReferenceData(prisma);
  await seedConfig(prisma);
  await prisma.setting.update({ where: { key: 'registration_open' }, data: { value: true } });
  return (await prisma.gradeLevel.findUniqueOrThrow({ where: { sortOrder: 5 } })).id;
}

/** The keys these tests touch in the cache Redis (registration info, the pause, the verify windows). */
export async function clearCache(cache: Redis): Promise<void> {
  const keys = await cache.keys('pay:*');
  await cache.del('registration:info', 'reg:payments-paused', ...keys);
}

let nextIp = 0;
const run = randomUUID().slice(0, 4);
export const ip = () => `2001:db8:${run}:${(nextIp += 1).toString(16)}::2`;
export const email = () => `p-${randomUUID().slice(0, 8)}@test.invalid`;

export type Call = (
  method: string,
  path: string,
  opts?: { body?: unknown; cookie?: string; csrf?: boolean; redirect?: 'manual' | 'follow' },
) => Promise<Response>;

export function caller(base: string): Call {
  return (method, path, opts = {}) =>
    fetch(`${base}/api${path}`, {
      method,
      redirect: opts.redirect ?? 'manual',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip(),
        ...(opts.csrf === false ? {} : { 'x-requested-with': 'XMLHttpRequest' }),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
}

export const regCookie = (res: Response): string => {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('sirat_reg='));
  if (!raw) throw new Error('no sirat_reg cookie');
  return raw.split(';')[0] as string;
};

export type Started = {
  paymentId: string;
  invoiceNumber: string;
  attemptId: string;
  cookie: string;
  email: string;
  phone: string;
};

/** Busy answers the start helper sends again (a loaded shared dev Postgres; lead, 2026-11-01). */
export const START_BUSY_RETRIES = 4;

/** POST /registrations/start through HTTP; returns the new payment (pending, with a fake checkout). */
export async function startRegistration(
  env: PaymentsApp,
  over: Record<string, unknown> = {},
): Promise<Started> {
  const call = caller(env.base);
  const body = {
    startRequestId: randomUUID(),
    name: 'TEST Payer',
    phone: testPhone(),
    email: email(),
    password: PASSWORD,
    district: 'Dhaka',
    institution: 'Sirat Test School',
    educationType: EDUCATION_TYPES[0],
    gradeLevelId: env.gradeLevelId,
    ...over,
  };
  let res = await call('POST', '/registrations/start', { body });
  // A busy database answers 503 SERVICE_BUSY and applied nothing (#52): like the wizard, send the same start (same
  // startRequestId) again after Retry-After, a few times. Any other answer, a 500 included, still fails the test.
  for (let retry = 1; res.status === 503 && retry <= START_BUSY_RETRIES; retry += 1) {
    const answer = (await res
      .clone()
      .json()
      .catch(() => null)) as { code?: unknown } | null;
    if (answer?.code !== 'SERVICE_BUSY') break;
    const after = Number(res.headers.get('retry-after'));
    await new Promise((r) => setTimeout(r, Math.min(after > 0 ? after : 1, 5) * 1000));
    res = await call('POST', '/registrations/start', { body });
  }
  if (res.status !== 201) throw new Error(`start answered ${res.status}: ${await res.text()}`);
  const out = (await res.json()) as { invoiceNumber: string };
  const payment = await env.prisma.payment.findUniqueOrThrow({
    where: { invoiceNumber: out.invoiceNumber },
  });
  return {
    paymentId: payment.id,
    invoiceNumber: payment.invoiceNumber,
    attemptId: payment.pendingRegistrationId,
    cookie: regCookie(res),
    email: body.email as string,
    phone: body.phone as string,
  };
}

/** A session cookie for a new user with this role (the session service, as admin-exams.int-spec does). */
export async function loginAs(
  env: PaymentsApp,
  role: Role,
): Promise<{ id: string; cookie: string }> {
  const user = await makeUser(env.prisma, { role });
  const issued = await env.sessions.start(
    { id: user.id, role: user.role },
    { ip: '203.0.113.7', userAgent: 'jest' },
  );
  return { id: user.id, cookie: `${ACCESS_COOKIE}=${issued.accessToken}` };
}

/** The fake checkout of an invoice (tests change its status or trx_id as PayStation would). */
export function checkout(env: PaymentsApp, invoiceNumber: string) {
  const c = env.fake.checkouts.get(invoiceNumber);
  if (!c) throw new Error(`no fake checkout for ${invoiceNumber}`);
  return c;
}
