/**
 * A busy database answers 503 SERVICE_BUSY, never 500 (lead, 2026-11-01: k6 under a CPU hog got P2028 from start's
 * transaction as 500). Through the real AppModule: a start whose transaction hits P2028 answers 503 with Retry-After,
 * nothing is left behind, and the same startRequestId then registers once; a login that meets a busy database is not
 * a failed login (no count, no lock). The filter's own cases are in all-exceptions.filter.spec.ts.
 */
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { EDUCATION_TYPES } from '@sirat/shared';
import { BUSY_RETRY_AFTER_SECONDS } from '../src/common/all-exceptions.filter';
import type { EnvVars } from '../src/config/env';
import { PasswordService } from '../src/modules/auth/password.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { makeUser } from './helpers';
import {
  PASSWORD,
  bootPaymentsApp,
  caller,
  email,
  ip,
  startRegistration,
  type PaymentsApp,
} from './payments-app';

let env: PaymentsApp;
let prisma: PrismaService;

beforeAll(async () => {
  env = await bootPaymentsApp();
  prisma = env.app.get(PrismaService);
}, 60_000);

afterAll(async () => {
  await env?.close();
});

afterEach(() => jest.restoreAllMocks());

const busy = (code: 'P2028' | 'P2024') =>
  new Prisma.PrismaClientKnownRequestError('Transaction API error', {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });

describe('POST /registrations/start meets a busy database', () => {
  it('answers 503 SERVICE_BUSY with Retry-After, leaves nothing, and the same startRequestId then registers once', async () => {
    const startRequestId = randomUUID();
    const address = email();
    // The attempt and its payment are written in start's one interactive transaction (createAttempt).
    const tx = jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(busy('P2028'));
    const first = await caller(env.base)('POST', '/registrations/start', {
      body: startBody(startRequestId, address),
    });
    expect(first.status).toBe(503);
    expect(first.headers.get('retry-after')).toBe(String(BUSY_RETRY_AFTER_SECONDS));
    expect(await first.json()).toMatchObject({ statusCode: 503, code: 'SERVICE_BUSY' });
    expect(tx).toHaveBeenCalledTimes(1);
    expect(await env.prisma.pendingRegistration.count({ where: { startRequestId } })).toBe(0);

    // The wizard sends the same body again (same startRequestId): a fresh start, exactly once.
    const again = await caller(env.base)('POST', '/registrations/start', {
      body: startBody(startRequestId, address),
    });
    expect(again.status).toBe(201);
    expect(await env.prisma.pendingRegistration.count({ where: { email: address } })).toBe(1);
    expect(
      await env.prisma.payment.count({ where: { pendingRegistration: { email: address } } }),
    ).toBe(1);
  });

  it('a start that did commit is replayed by the same startRequestId, not started twice', async () => {
    const s = await startRegistration(env, { startRequestId: randomUUID() });
    const attempt = await env.prisma.pendingRegistration.findUniqueOrThrow({
      where: { id: s.attemptId },
    });
    const replay = await caller(env.base)('POST', '/registrations/start', {
      body: startBody(attempt.startRequestId, s.email, s.phone),
    });
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as { invoiceNumber: string }).invoiceNumber).toBe(
      s.invoiceNumber,
    );
    expect(await env.prisma.pendingRegistration.count({ where: { email: s.email } })).toBe(1);
  });
});

describe('POST /auth/login meets a busy database', () => {
  it('answers 503 and never counts as a failed login: no lock after more busy tries than the limit', async () => {
    const password = 'Calm-harbour-river-7';
    const user = await makeUser(env.prisma, {
      passwordHash: await env.app.get(PasswordService).hash(password),
      emailVerifiedAt: new Date(),
    });
    const limit = env.app
      .get<ConfigService<EnvVars, true>>(ConfigService)
      .get('LOGIN_PAIR_MAX_FAILURES', { infer: true });
    const from = ip();
    // One account + IP pair throughout (the pair is what locks); `caller` draws a new IP per request.
    const login = (pw: string) =>
      fetch(`${env.base}/api/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': from,
          'x-requested-with': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email: user.email, password: pw }),
      });

    // The account lookup meets a pool timeout on every try, with a wrong password each time.
    const lookup = jest.spyOn(prisma.user, 'findUnique').mockRejectedValue(busy('P2024'));
    for (let i = 0; i <= limit; i += 1) {
      const res = await login('Wrong-password-123');
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe(String(BUSY_RETRY_AFTER_SECONDS));
    }
    lookup.mockRestore();

    // Had the busy tries counted, this pair would now be locked (429). It logs in.
    expect((await login(password)).status).toBe(204);
    expect(
      await env.prisma.auditLog.count({ where: { action: 'auth.login_failed', actorId: user.id } }),
    ).toBe(0);
  });
});

function startBody(startRequestId: string, address: string, phone?: string) {
  return {
    startRequestId,
    name: 'TEST Busy',
    phone: phone ?? `017${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    email: address,
    password: PASSWORD,
    district: 'Dhaka',
    institution: 'Sirat Test School',
    educationType: EDUCATION_TYPES[0],
    gradeLevelId: env.gradeLevelId,
  };
}
