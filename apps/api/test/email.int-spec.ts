/**
 * Email through the real queue Redis and Mailpit (owner: until the domain is verified, email is tested with
 * Mailpit): EmailQueue → BullMQ → EmailWorker → provider. Each test uses its own queue, so a running dev worker
 * never takes these jobs; messages are found in Mailpit by a token unique to this run and deleted afterwards.
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { EnvVars } from '../src/config/env';
import { EmailQueue } from '../src/modules/notifications/email-queue.service';
import {
  type EmailMessage,
  type EmailProvider,
  PermanentEmailError,
} from '../src/modules/notifications/email.types';
import { EmailWorker } from '../src/modules/notifications/email.worker';
import { MailpitProvider } from '../src/modules/notifications/mailpit.provider';
import { QUEUE_REDIS_OPTIONS } from '../src/redis/redis.module';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18025';
const REDIS_URL = process.env.REDIS_QUEUE_URL as string;
const config = { get: () => REDIS_URL } as unknown as ConfigService<EnvVars, true>;
const run = randomUUID().replace(/-/g, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let redis: Redis;
const cleanup: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  Logger.overrideLogger(false);
  redis = new Redis(REDIS_URL, QUEUE_REDIS_OPTIONS);
  await redis.ping();
});

afterAll(async () => {
  for (const step of cleanup.reverse()) await step();
  await fetch(`${MAILPIT}/api/v1/search?query=${run}`, { method: 'DELETE' });
  await redis.quit();
});

/** A queue of its own for one test: producer, raw BullMQ handle, and a way to start the worker. */
function testQueue() {
  const name = `email-test-${randomUUID()}`;
  const producer = new EmailQueue(redis, name);
  const raw = new Queue(name, { connection: redis });
  cleanup.push(async () => {
    await producer.onApplicationShutdown();
    await raw.obliterate({ force: true });
    await raw.close();
  });
  const startWorker = (provider: EmailProvider) => {
    const worker = new EmailWorker(provider, config, name);
    worker.onModuleInit();
    cleanup.push(() => worker.onApplicationShutdown());
    return worker;
  };
  return { producer, raw, startWorker };
}

async function waitFor<T>(probe: () => Promise<T | undefined>, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error('timed out waiting');
    await sleep(100);
  }
}

type Summary = { ID: string };
async function inMailpit(token: string): Promise<Summary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(token)}`);
  return ((await res.json()) as { messages: Summary[] }).messages;
}

const mail = (token: string): EmailMessage => ({
  to: 'student@sirat.test',
  subject: `Verify your email ${token}`,
  text: `Open https://sirat.test/verify?t=${token}`,
});

describe('email pipeline (queue Redis + worker + Mailpit)', () => {
  it('delivers a queued email with the right sender, recipient, subject, text and idempotency key', async () => {
    const { producer, startWorker } = testQueue();
    startWorker(new MailpitProvider(MAILPIT, 'Sirat Olympiad <no-reply@sirat.test>'));
    const token = `${run}a`;
    await expect(
      producer.enqueue('verify-email', `verify-email.${token}`, mail(token)),
    ).resolves.toBe(true);

    const [summary] = await waitFor(async () => {
      const found = await inMailpit(token);
      return found.length > 0 ? found : undefined;
    });
    const message = (await (await fetch(`${MAILPIT}/api/v1/message/${summary?.ID}`)).json()) as {
      From: { Name: string; Address: string };
      To: { Address: string }[];
      Subject: string;
      Text: string;
    };
    expect(message.From).toMatchObject({ Name: 'Sirat Olympiad', Address: 'no-reply@sirat.test' });
    expect(message.To).toMatchObject([{ Address: 'student@sirat.test' }]);
    expect(message.Subject).toBe(`Verify your email ${token}`);
    expect(message.Text).toContain(`t=${token}`);
    const headers = (await (
      await fetch(`${MAILPIT}/api/v1/message/${summary?.ID}/headers`)
    ).json()) as Record<string, string[]>;
    expect(headers['X-Idempotency-Key']).toEqual([`verify-email.${token}`]);
  });

  it('queues a key once: the same email enqueued twice is sent once', async () => {
    const { producer, startWorker } = testQueue();
    const token = `${run}b`;
    await producer.enqueue('verify-email', `verify-email.${token}`, mail(token));
    await producer.enqueue('verify-email', `verify-email.${token}`, mail(token)); // still waiting: deduplicated
    startWorker(new MailpitProvider(MAILPIT, 'no-reply@sirat.test'));
    await waitFor(async () => ((await inMailpit(token)).length > 0 ? true : undefined));
    await sleep(1_000); // room for a duplicate to arrive
    expect(await inMailpit(token)).toHaveLength(1);
  });

  it('fails a permanent error at once instead of using the 8 attempts', async () => {
    const { producer, raw, startWorker } = testQueue();
    const send = jest.fn(async () => {
      throw new PermanentEmailError('Mailpit answered 400');
    });
    startWorker({ name: 'stub', send });
    const key = `verify-email.${run}c`;
    await producer.enqueue('verify-email', key, mail(`${run}c`));
    const job = await waitFor(async () => {
      const j = await raw.getJob(key);
      return j && (await j.isFailed()) ? j : undefined;
    });
    expect(job.attemptsMade).toBe(1);
    expect(job.failedReason).toBe('Mailpit answered 400');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries a temporary error, then delivers', async () => {
    const { raw, startWorker } = testQueue();
    let calls = 0;
    startWorker({
      name: 'stub',
      send: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Mailpit answered 502');
      },
    });
    // Short backoff for the test; production uses EMAIL_JOB_OPTIONS (8 attempts from 30 s, unit-tested).
    const job = await raw.add(
      'verify-email',
      { kind: 'verify-email', message: mail(`${run}d`) },
      { jobId: `verify-email.${run}d`, attempts: 3, backoff: { type: 'fixed', delay: 50 } },
    );
    await waitFor(async () => ((await job.isCompleted()) ? true : undefined));
    expect(calls).toBe(2);
    expect((await raw.getJob(`verify-email.${run}d`))?.attemptsMade).toBe(2);
  });
});
