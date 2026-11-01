/**
 * Operator alert emails (owner, 2026-10-31): the audit row and the log line come first and never depend on email;
 * the email is rate limited (one per alert kind per 10 minutes, an hourly cap per category, L10) and a failed email
 * blocks nothing.
 * Real queue Redis, cache Redis, Mailpit and an in-process worker; every test has its own Redis prefix and inbox.
 */
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { OpsAlertUsageError, parseOpsAlertArgs, raiseOpsAlert } from '../src/cli/ops-alert';
import { BackgroundTasks } from '../src/common/background/background-tasks';
import type { EnvVars } from '../src/config/env';
import { AlertEmailLimiter } from '../src/modules/audit/alert-email-limiter';
import { AuditService } from '../src/modules/audit/audit.service';
import { SecurityAlerts } from '../src/modules/audit/security-alerts.service';
import { EmailQueue } from '../src/modules/notifications/email-queue.service';
import { EmailWorker } from '../src/modules/notifications/email.worker';
import { MailpitProvider } from '../src/modules/notifications/mailpit.provider';
import type { PrismaService } from '../src/prisma/prisma.service';
import { QUEUE_REDIS_OPTIONS } from '../src/redis/redis.module';
import { testPrisma } from './helpers';

// The limiter withholds an email when Redis has not answered within 300 ms (by design: no Redis, no email). On a
// loaded machine a reply can take longer, and an alert these tests expect in the inbox was held back. The file proves
// the audit-first order, the limits and the content, not that timeout, so every withTimeout here waits 20 times
// longer (a dead client still fails at once: the limiter and the queue check its status first).
jest.mock('../src/common/with-timeout', () => {
  const actual = jest.requireActual<typeof import('../src/common/with-timeout')>(
    '../src/common/with-timeout',
  );
  return {
    withTimeout: <T>(promise: Promise<T>, ms: number) => actual.withTimeout(promise, ms * 20),
  };
});

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18025';
const QUEUE = `email-test-${randomUUID()}`;
const run = randomUUID().slice(0, 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const prisma: PrismaClient = testPrisma();
const audit = new AuditService(prisma as unknown as PrismaService);
let queueRedis: Redis;
let cacheRedis: Redis;
let emails: EmailQueue;
let raw: Queue;
let worker: EmailWorker;
const background = new BackgroundTasks();

beforeAll(async () => {
  queueRedis = new Redis(process.env.REDIS_QUEUE_URL as string, QUEUE_REDIS_OPTIONS);
  cacheRedis = new Redis(process.env.REDIS_CACHE_URL as string, { maxRetriesPerRequest: 1 });
  await Promise.all([queueRedis.ping(), cacheRedis.ping()]);
  emails = new EmailQueue(queueRedis, QUEUE);
  raw = new Queue(QUEUE, { connection: queueRedis });
  const config = { get: () => process.env.REDIS_QUEUE_URL } as unknown as ConfigService<
    EnvVars,
    true
  >;
  worker = new EmailWorker(new MailpitProvider(MAILPIT, 'no-reply@sirat.test'), config, QUEUE);
  worker.onModuleInit();
});

afterAll(async () => {
  await background.idle();
  await worker.onApplicationShutdown();
  await emails.onApplicationShutdown();
  await raw.obliterate({ force: true });
  await raw.close();
  const keys = await cacheRedis.keys(`alertmail-test:${run}:*`);
  if (keys.length > 0) await cacheRedis.del(...keys);
  await fetch(`${MAILPIT}/api/v1/search?query=${run}`, { method: 'DELETE' });
  await Promise.all([queueRedis.quit(), cacheRedis.quit(), prisma.$disconnect()]);
});

let n = 0;
/** One SecurityAlerts with its own limiter prefix and its own operator inbox. */
function alertsWith(
  perHour: number,
  opts: { inbox?: boolean; queue?: EmailQueue; cache?: Redis; address?: string } = {},
) {
  n += 1;
  const inbox = opts.address ?? `ops-${run}-${n}@sirat.test`;
  const limiter = new AlertEmailLimiter(
    opts.cache ?? cacheRedis,
    perHour,
    `alertmail-test:${run}:${n}:`,
  );
  const alerts = new SecurityAlerts(
    audit,
    opts.queue ?? emails,
    background,
    limiter,
    opts.inbox === false ? undefined : inbox,
  );
  return { alerts, inbox, limiter };
}

/**
 * Holds the email path at its first step (the limiter) until `release()`: a caller that waited for the email could
 * not return while it is held. A backstop releases it after 10 s, so such a caller fails the test instead of hanging.
 */
function holdEmailPath(limiter: AlertEmailLimiter) {
  const state = { entered: false, released: false };
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const backstop = setTimeout(() => release(), 10_000);
  function release() {
    clearTimeout(backstop);
    state.released = true;
    open();
  }
  const allow = limiter.allow.bind(limiter);
  jest.spyOn(limiter, 'allow').mockImplementation(async (kind, category) => {
    state.entered = true;
    await opened;
    return allow(kind, category);
  });
  return { state, release };
}

/** Resolves once the worker has handled every queued email (a job leaves the queue after Mailpit accepted it). */
async function queueDrained(): Promise<void> {
  const until = Date.now() + 20_000;
  for (;;) {
    const counts = await raw.getJobCounts('waiting', 'active', 'delayed', 'prioritized', 'paused');
    if (Object.values(counts).every((c) => c === 0)) return;
    if (Date.now() > until) throw new Error(`email queue not drained: ${JSON.stringify(counts)}`);
    await sleep(50);
  }
}

async function inboxOf(to: string) {
  await background.idle(); // every alert's email path has finished: queued, or held back
  await queueDrained(); // and everything queued is in Mailpit, duplicates included
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await res.json()) as { messages: { ID: string; Subject: string }[] }).messages;
}

const event = (actorId = randomUUID()) => ({
  actorId,
  ip: '203.0.113.99',
  meta: { accountFailures: 50, distinctIps: 21 },
});

describe('SecurityAlerts', () => {
  it('writes every alert to the audit log, but emails the operator once per kind per 10 minutes', async () => {
    const { alerts, inbox } = alertsWith(10);
    const actorId = randomUUID();
    await alerts.raise('login.account_limit', event(actorId));
    await alerts.raise('login.account_limit', event(actorId));
    expect(
      await prisma.auditLog.count({ where: { action: 'security.login.account_limit', actorId } }),
    ).toBe(2);

    const mails = await inboxOf(inbox);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.Subject).toContain('Security alert');
    const message = (await (await fetch(`${MAILPIT}/api/v1/message/${mails[0]?.ID}`)).json()) as {
      Text: string;
    };
    expect(message.Text).toContain(actorId);
    expect(message.Text).toContain('accountFailures: 50');
    expect(message.Text).not.toContain('203.0.113.99'); // the IP stays in the audit log
  });

  it('mails different kinds separately, but never more than the hourly cap of their category', async () => {
    const two = alertsWith(2);
    await two.alerts.raise('login.account_limit', event());
    await two.alerts.raise('login.distributed', event());
    expect(await inboxOf(two.inbox)).toHaveLength(2);

    const one = alertsWith(1);
    await one.alerts.raise('login.account_limit', event());
    await one.alerts.raise('login.distributed', event()); // another kind, but its category's cap is 1
    expect(await inboxOf(one.inbox)).toHaveLength(1);
  });

  it('gives each category its own hourly cap: a security flood never silences payments or ops (L10)', async () => {
    const { alerts, inbox } = alertsWith(1, {
      address: `alerts-${run}-categories@example.invalid`,
    });
    await alerts.raise('login.account_limit', event());
    await alerts.raise('login.distributed', event()); // security again: over its cap of 1
    await alerts.raise('payments.needs_review', { actorId: null, meta: { reasonCode: 2 } });
    await alerts.raise('ops.alert_test', { actorId: null, meta: { drill: 1 } });
    const subjects = (await inboxOf(inbox)).map((m) => m.Subject).sort();
    expect(subjects).toHaveLength(3);
    expect(subjects[0]).toMatch(/^\[Sirat\] Ops alert: /);
    expect(subjects[1]).toMatch(/^\[Sirat\] Payments alert: /);
    expect(subjects[2]).toMatch(/^\[Sirat\] Security alert: /);
  });

  it('ops-alert records an ops alert with numeric details and mails it, with no Account line (L10)', async () => {
    const { alerts, inbox } = alertsWith(10, { address: `alerts-${run}-cli@example.invalid` });
    const step = 1000 + Math.floor(Math.random() * 1000); // finds this test's audit row
    await raiseOpsAlert(
      parseOpsAlertArgs(['--kind', 'ops.backup_failed', '--meta', `step=${step}`]),
      {
        alerts,
        background,
      },
    );
    const rows = await prisma.auditLog.findMany({
      where: { action: 'security.ops.backup_failed', actorId: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    expect(rows.some((r) => (r.meta as { step?: number } | null)?.step === step)).toBe(true);
    const mails = await inboxOf(inbox);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.Subject).toMatch(/^\[Sirat\] Ops alert: A database backup/);
    const message = (await (await fetch(`${MAILPIT}/api/v1/message/${mails[0]?.ID}`)).json()) as {
      Text: string;
    };
    expect(message.Text).toContain(`step: ${step}`);
    expect(message.Text).not.toContain('Account:');
    // The command cannot raise another category's alert.
    expect(() => parseOpsAlertArgs(['--kind', 'payments.needs_review'])).toThrow(
      OpsAlertUsageError,
    );
  });

  it('without an operator address: audit row and log only', async () => {
    const { alerts, inbox } = alertsWith(10, { inbox: false });
    const actorId = randomUUID();
    await alerts.raise('login.distributed', event(actorId));
    expect(
      await prisma.auditLog.count({ where: { action: 'security.login.distributed', actorId } }),
    ).toBe(1);
    expect(await inboxOf(inbox)).toEqual([]);
  });

  it('never blocks: a dead email queue or a dead rate limiter changes nothing for the caller', async () => {
    const dead = new Redis({
      host: '127.0.0.1',
      port: 1,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    dead.on('error', () => undefined);
    const deadQueue = new EmailQueue(dead, `${QUEUE}-dead`);
    try {
      for (const opts of [{ queue: deadQueue }, { cache: dead }]) {
        const { alerts, inbox, limiter } = alertsWith(10, opts);
        const held = holdEmailPath(limiter);
        const actorId = randomUUID();
        try {
          await expect(
            alerts.raise('login.account_limit', event(actorId)),
          ).resolves.toBeUndefined();
          // The email part never waits in the caller: the call returned while its email was still held.
          expect(held.state).toEqual({ entered: true, released: false });
        } finally {
          held.release(); // the dead queue or dead limiter now fails in the background
        }
        expect(
          await prisma.auditLog.count({
            where: { action: 'security.login.account_limit', actorId },
          }),
        ).toBe(1);
        expect(await inboxOf(inbox)).toEqual([]); // no limiter, no email: the audit row is the record
      }
    } finally {
      // Closed even when an assertion fails, so no dead client keeps the test process alive.
      dead.disconnect();
      await Promise.race([deadQueue.onApplicationShutdown(), sleep(1_000)]).catch(() => undefined);
    }
  });
});
