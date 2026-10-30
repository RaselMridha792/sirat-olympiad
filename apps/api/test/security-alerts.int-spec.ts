/**
 * Operator alert emails (owner, 2026-10-31): the audit row and the log line come first and never depend on email;
 * the email is rate limited (one per alert kind per 10 minutes, an hourly cap) and a failed email blocks nothing.
 * Real queue Redis, cache Redis, Mailpit and an in-process worker; every test has its own Redis prefix and inbox.
 */
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
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

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18025';
const QUEUE = `email-test-${randomUUID()}`;
const run = randomUUID().slice(0, 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const prisma: PrismaClient = testPrisma();
const audit = new AuditService(prisma as unknown as PrismaService);
let queueRedis: Redis;
let cacheRedis: Redis;
let emails: EmailQueue;
let worker: EmailWorker;
const background = new BackgroundTasks();

beforeAll(async () => {
  queueRedis = new Redis(process.env.REDIS_QUEUE_URL as string, QUEUE_REDIS_OPTIONS);
  cacheRedis = new Redis(process.env.REDIS_CACHE_URL as string, { maxRetriesPerRequest: 1 });
  await Promise.all([queueRedis.ping(), cacheRedis.ping()]);
  emails = new EmailQueue(queueRedis, QUEUE);
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
  const raw = new Queue(QUEUE, { connection: queueRedis });
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
  opts: { inbox?: boolean; queue?: EmailQueue; cache?: Redis } = {},
) {
  n += 1;
  const inbox = `ops-${run}-${n}@sirat.test`;
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
  return { alerts, inbox };
}

async function inboxOf(to: string) {
  await background.idle();
  await sleep(1_500); // the worker delivers to Mailpit
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

  it('mails different kinds separately, but never more than the hourly cap in all', async () => {
    const two = alertsWith(2);
    await two.alerts.raise('login.account_limit', event());
    await two.alerts.raise('login.distributed', event());
    expect(await inboxOf(two.inbox)).toHaveLength(2);

    const one = alertsWith(1);
    await one.alerts.raise('login.account_limit', event());
    await one.alerts.raise('login.distributed', event()); // another kind, but the hour cap is 1
    expect(await inboxOf(one.inbox)).toHaveLength(1);
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
        const { alerts, inbox } = alertsWith(10, opts);
        const actorId = randomUUID();
        const started = Date.now();
        await expect(alerts.raise('login.account_limit', event(actorId))).resolves.toBeUndefined();
        expect(Date.now() - started).toBeLessThan(500); // the email part never waits in the caller
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
