/**
 * Email-link endpoints over HTTP (RULEBOOK §5), end to end through the queue, a worker and Mailpit:
 * forgot-password and resend-verification always answer 204 at once and email only real, unblocked accounts;
 * verify-email marks the address verified and never logs in; every bad link gets one answer.
 * The app's email queue is swapped for a queue of this test, served by an in-process worker.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AuthTokenType, type PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { BackgroundTasks } from '../src/common/background/background-tasks';
import type { EnvVars } from '../src/config/env';
import { EmailTokenService } from '../src/modules/auth/email-tokens.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { EmailQueue } from '../src/modules/notifications/email-queue.service';
import { EmailWorker } from '../src/modules/notifications/email.worker';
import { MailpitProvider } from '../src/modules/notifications/mailpit.provider';
import { REDIS_QUEUE } from '../src/redis/redis.module';
import { formatParticipantId } from '@sirat/shared';
import { makePaidPayment, makeUser, testPrisma } from './helpers';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18025';
const QUEUE = `email-test-${randomUUID()}`;
const run = randomUUID().slice(0, 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let tokens: EmailTokenService;
let worker: EmailWorker;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  process.env.APP_URL = 'http://sirat.test'; // read when AppModule is imported below
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailQueue)
    .useFactory({ factory: (redis: Redis) => new EmailQueue(redis, QUEUE), inject: [REDIS_QUEUE] })
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  prisma = testPrisma();
  tokens = app.get(EmailTokenService);
  const config = { get: () => process.env.REDIS_QUEUE_URL } as unknown as ConfigService<
    EnvVars,
    true
  >;
  worker = new EmailWorker(
    new MailpitProvider(MAILPIT, 'Sirat Olympiad <no-reply@sirat.test>'),
    config,
    QUEUE,
  );
  worker.onModuleInit();
}, 60_000);

afterAll(async () => {
  await worker?.onApplicationShutdown();
  if (app) {
    const raw = new Queue(QUEUE, { connection: app.get<Redis>(REDIS_QUEUE) });
    await raw.obliterate({ force: true });
    await raw.close();
    await app.close();
  }
  await fetch(`${MAILPIT}/api/v1/search?query=${run}`, { method: 'DELETE' });
  await prisma?.$disconnect();
});

// A /64 of its own per run and per call: per-IP counters live in Redis across runs.
let nextIp = 0;
const newIp = () => `2001:db8:${run.slice(0, 4)}:${(nextIp += 1).toString(16)}::1`;
let nextMail = 0;
const address = (kind: string) => `${kind}-${run}-${(nextMail += 1)}@test.invalid`;

function post(path: string, body: unknown, csrf = true) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': newIp(),
  };
  if (csrf) headers['x-requested-with'] = 'XMLHttpRequest';
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
const verify = (token: string, csrf = true) => post('/api/auth/verify-email', { token }, csrf);
const unverified = (email = address('v')) => makeUser(prisma, { email, emailVerifiedAt: null });

type Summary = { ID: string };
async function mailsTo(to: string): Promise<Summary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await res.json()) as { messages: Summary[] }).messages;
}
async function waitForMail(to: string): Promise<{ Subject: string; Text: string }> {
  for (let i = 0; i < 100; i += 1) {
    const [first] = await mailsTo(to);
    if (first)
      return (await (await fetch(`${MAILPIT}/api/v1/message/${first.ID}`)).json()) as {
        Subject: string;
        Text: string;
      };
    await sleep(100);
  }
  throw new Error(`no email to ${to}`);
}
/** Lets the background work and the worker finish, so "no email" is a real absence. */
async function settle() {
  await app.get(BackgroundTasks).idle();
  await sleep(1_500);
}
const tokenIn = (text: string) => /#token=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? '';

describe('POST /api/auth/forgot-password', () => {
  it('answers 204 with an empty body, and the emailed link resets the password', async () => {
    const email = address('f');
    // Staff: only they have a password to reset (students get their participant ID, below).
    await makeUser(prisma, {
      email,
      name: 'Ayesha',
      role: 'jury',
      passwordHash: await app.get(PasswordService).hash('Old-river-moon-42'),
    });
    const res = await post('/api/auth/forgot-password', { email: email.toUpperCase() });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(res.headers.getSetCookie()).toEqual([]);

    const mail = await waitForMail(email);
    expect(mail.Subject).toContain('Reset your password');
    expect(mail.Text).toContain('প্রিয় Ayesha');
    expect(mail.Text).toContain('http://sirat.test/reset-password#token=');
    const reset = await post('/api/auth/reset-password', {
      token: tokenIn(mail.Text),
      password: 'New-hill-sun-77',
    });
    expect(reset.status).toBe(204);
    const login = await post('/api/auth/login', { email, password: 'New-hill-sun-77' });
    expect(login.status).toBe(204);
  });

  it('answers unknown and blocked addresses the same way and sends them nothing', async () => {
    const unknown = address('f');
    const blocked = address('f');
    await makeUser(prisma, { email: blocked, isBlocked: true });
    for (const email of [unknown, blocked]) {
      const res = await post('/api/auth/forgot-password', { email });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    }
    await settle();
    expect(await mailsTo(unknown)).toEqual([]);
    expect(await mailsTo(blocked)).toEqual([]);
  });

  it('sends one email per address per minute, however often it is asked', async () => {
    const email = address('f');
    await makeUser(prisma, { email, role: 'jury' });
    for (let i = 0; i < 3; i += 1)
      expect((await post('/api/auth/forgot-password', { email })).status).toBe(204);
    await waitForMail(email);
    await settle();
    expect(await mailsTo(email)).toHaveLength(1);
  });
});

describe('POST /api/auth/forgot-id (students and ambassadors)', () => {
  /** A student with a paid registration, so a participant ID, and no password. */
  async function registered(email: string, data: Parameters<typeof makeUser>[1] = {}) {
    const user = await makeUser(prisma, { email, name: 'Rahim', role: 'student', ...data });
    const payment = await makePaidPayment(prisma, user.id);
    const reg = await prisma.registration.create({
      data: { userId: user.id, paymentId: payment.id },
    });
    return { user, participantId: reg.participantId };
  }

  it("emails the participant ID to the account's own address only, and the answer says nothing", async () => {
    const email = address('id');
    const { user, participantId } = await registered(email);
    const res = await post('/api/auth/forgot-id', { email: email.toUpperCase() });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(res.headers.getSetCookie()).toEqual([]);
    const mail = await waitForMail(email);
    expect(mail.Subject).toContain('Your participant ID');
    expect(mail.Text).toContain('প্রিয় Rahim');
    expect(mail.Text).toContain(formatParticipantId(participantId));
    expect(mail.Text).toContain('http://sirat.test/login');
    await settle();
    const rows = await prisma.auditLog.findMany({
      where: { action: 'auth.participant_id_sent', actorId: user.id },
    });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(participantId.slice(2)); // never the ID in the trail
  });

  it('sends nothing to an unknown address, a staff account, a blocked student or one without a registration', async () => {
    const [unknown, judge, blocked, plain] = [
      address('id'),
      address('id'),
      address('id'),
      address('id'),
    ];
    await makeUser(prisma, { email: judge, role: 'jury' });
    await registered(blocked, { isBlocked: true });
    await makeUser(prisma, { email: plain, role: 'student' });
    for (const email of [unknown, judge, blocked, plain]) {
      const res = await post('/api/auth/forgot-id', { email });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    }
    await settle();
    for (const email of [unknown, judge, blocked, plain]) expect(await mailsTo(email)).toEqual([]);
  });

  it('answers forgot-password for a student with the ID, never a reset link, under the same per-address cap', async () => {
    const email = address('id');
    const { participantId } = await registered(email);
    expect((await post('/api/auth/forgot-password', { email })).status).toBe(204);
    const mail = await waitForMail(email);
    expect(mail.Subject).toContain('Your participant ID');
    expect(mail.Text).toContain(formatParticipantId(participantId));
    expect(mail.Text).not.toContain('reset-password#token=');
    expect((await post('/api/auth/forgot-id', { email })).status).toBe(204); // the same minute: capped
    await settle();
    expect(await mailsTo(email)).toHaveLength(1);
    expect(
      await prisma.authToken.count({ where: { user: { email }, type: 'password_reset' } }),
    ).toBe(0);
  });
});

describe('POST /api/auth/resend-verification', () => {
  it('emails an unverified account a link that verifies it', async () => {
    const email = address('r');
    const user = await unverified(email);
    expect((await post('/api/auth/resend-verification', { email })).status).toBe(204);
    const mail = await waitForMail(email);
    expect(mail.Subject).toContain('Verify your email');
    expect(mail.Text).toContain('http://sirat.test/verify-email#token=');
    expect((await verify(tokenIn(mail.Text))).status).toBe(204);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).not.toBeNull();
  });

  it('answers verified, blocked and unknown addresses the same way and sends them nothing', async () => {
    const verified = address('r');
    const blocked = address('r');
    const unknown = address('r');
    await makeUser(prisma, { email: verified, emailVerifiedAt: new Date() });
    await makeUser(prisma, { email: blocked, emailVerifiedAt: null, isBlocked: true });
    for (const email of [verified, blocked, unknown])
      expect((await post('/api/auth/resend-verification', { email })).status).toBe(204);
    await settle();
    for (const email of [verified, blocked, unknown]) expect(await mailsTo(email)).toEqual([]);
  });

  it('both link requests refuse malformed input and need the CSRF header', async () => {
    for (const path of ['/api/auth/forgot-password', '/api/auth/resend-verification']) {
      expect((await post(path, { email: 'not-an-email' })).status).toBe(400);
      expect((await post(path, { email: address('x'), role: 'admin' })).status).toBe(400);
      expect((await post(path, { email: address('x') }, false)).status).toBe(403);
    }
  });
});

describe('POST /api/auth/verify-email', () => {
  it('marks the address verified and audits it, but never creates a session or sets a cookie', async () => {
    const user = await unverified();
    const { token } = await tokens.issue(user.id, AuthTokenType.email_verify);
    const res = await verify(token);
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).not.toBeNull();
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.email_verified', actorId: user.id } }),
    ).toBe(1);
  });

  it('answers a used, expired, unknown, reset-type or blocked-account link with one 400', async () => {
    const user = await unverified();
    const used = await tokens.issue(user.id, AuthTokenType.email_verify);
    expect((await verify(used.token)).status).toBe(204);
    const other = await unverified();
    const expired = await tokens.issue(other.id, AuthTokenType.email_verify);
    await prisma.authToken.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const resetType = await tokens.issue(other.id, AuthTokenType.password_reset);
    const blocked = await unverified();
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    const blockedLink = await tokens.issue(blocked.id, AuthTokenType.email_verify);

    for (const token of [
      used.token,
      expired.token,
      randomBytes(32).toString('base64url'),
      'short',
      resetType.token,
      blockedLink.token,
    ]) {
      const res = await verify(token);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { message: string }).message).toBe(
        'This link is invalid or has expired',
      );
    }
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(stored.emailVerifiedAt).toBeNull();
  });

  it('answers 204 for a valid link of an already verified account and changes nothing', async () => {
    const at = new Date('2026-10-01T10:00:00Z');
    const user = await makeUser(prisma, { emailVerifiedAt: at });
    const { token } = await tokens.issue(user.id, AuthTokenType.email_verify);
    expect((await verify(token)).status).toBe(204);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).toEqual(at);
  });

  it('lets exactly one of two simultaneous uses succeed, and needs the CSRF header', async () => {
    const user = await unverified();
    const { token } = await tokens.issue(user.id, AuthTokenType.email_verify);
    expect((await verify(token, false)).status).toBe(403);
    const results = await Promise.all([verify(token), verify(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
  });
});
