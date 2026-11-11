/**
 * The admit card PDF (core A2; 06-API "Admit card"; the lead's conditions of 2026-11-11): POST /admit-card/pdf queues
 * the caller's own card, the worker renders it into the cache Redis, GET /admit-card/pdf returns it. The PDF carries
 * the FULL participant ID once and never the email; owner only, never cached; a file is served only while the card
 * still matches it; a re-run of the job gives the same bytes; a user with no admit card now is skipped.
 */
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import { type AdmitCardPdfStatus, formatParticipantId } from '@sirat/shared';
import type Redis from 'ioredis';
import type { EnvVars } from '../src/config/env';
import {
  admitCardPdfJobId,
  admitCardPdfKey,
  ADMIT_CARD_PDF_TTL_SECONDS,
} from '../src/modules/admit-card/admit-card-pdf-queue';
import { AdmitCardPdfQueue } from '../src/modules/admit-card/admit-card-pdf.queue';
import { AdmitCardPdfWorker } from '../src/modules/admit-card/admit-card-pdf.worker';
import { AdmitCardService } from '../src/modules/admit-card/admit-card.service';
import { actualTexts } from '../src/modules/pdf/pdf-inspect';
import type { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CACHE, REDIS_QUEUE } from '../src/redis/redis.module';
import { bootCoreApp, call, registeredStudent, sessionFor, type CoreApp } from './core-helpers';
import { testPrisma } from './helpers';

const QUEUE = `admit-card-pdf-test-${randomUUID().slice(0, 8)}`;

let env: CoreApp;
let prisma: PrismaClient;
let cache: Redis;
let worker: AdmitCardPdfWorker;

beforeAll(async () => {
  // The API under test puts its jobs on this run's own queue; the worker below takes them from it.
  process.env.ADMIT_CARD_PDF_QUEUE_NAME = QUEUE;
  env = await bootCoreApp();
  prisma = testPrisma();
  cache = env.app.get(REDIS_CACHE);
  const values: Record<string, string> = {
    REDIS_QUEUE_URL: process.env.REDIS_QUEUE_URL as string,
    ADMIT_CARD_PDF_QUEUE_NAME: QUEUE,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<EnvVars, true>;
  worker = new AdmitCardPdfWorker(
    new AdmitCardService(prisma as unknown as PrismaService),
    cache,
    config,
  );
  worker.onModuleInit();
}, 60_000);

afterAll(async () => {
  await worker?.onApplicationShutdown();
  delete process.env.ADMIT_CARD_PDF_QUEUE_NAME;
  await env?.app.close();
  await prisma?.$disconnect();
});

const details = (json: unknown) => (json as { details?: string[] }).details;

/** GET /admit-card/pdf as bytes (call() decodes text, which would break a PDF). */
async function download(cookie: string, locale = 'bn') {
  const res = await fetch(`${env.base}/api/admit-card/pdf?locale=${locale}`, {
    headers: { cookie },
  });
  return {
    status: res.status,
    headers: res.headers,
    bytes: new Uint8Array(await res.arrayBuffer()),
  };
}

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function registered(name: string) {
  const { user, registration } = await registeredStudent(prisma, { name });
  const s = await env.sessions.start(
    { id: user.id, role: user.role },
    { ip: '203.0.113.62', userAgent: 'jest' },
  );
  return { user, registration, cookie: `sirat_access=${s.accessToken}` };
}

const count = (text: string, part: string) => text.split(part).length - 1;

describe('the admit card PDF', () => {
  it('is rendered through the queue: the full ID once, never the email; owner only, no-store, a file download', async () => {
    const me = await registered('PDF Admit Student');
    const other = await registered('PDF Other Student');
    const asked = await call<AdmitCardPdfStatus>(env, 'POST', '/admit-card/pdf', me.cookie, {
      locale: 'bn',
    });
    expect(asked.status).toBe(200);
    expect(asked.headers.get('cache-control')).toBe('no-store');
    expect(asked.json).toEqual({ status: 'pending' });

    const res = await until(
      () => download(me.cookie),
      (r) => r.status === 200,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('no-store');
    // The file's name carries no ID and no name.
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="admit-card.pdf"');
    expect(Buffer.from(res.bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const text = actualTexts(res.bytes).join('');
    expect(count(text, formatParticipantId(me.registration.participantId))).toBe(1);
    expect(text).toContain('PDF Admit Student');
    // Never the other half of the login, and nothing of another student.
    expect(text).not.toContain(me.user.email);
    expect(text).not.toContain('@');
    expect(text).not.toContain(formatParticipantId(other.registration.participantId));
    expect(text).not.toContain('PDF Other Student');

    // Asked again: the file is waiting.
    expect((await call(env, 'POST', '/admit-card/pdf', me.cookie, { locale: 'bn' })).json).toEqual({
      status: 'ready',
    });
    // Another student never gets it: their own card is not made, and they have no way to name another's.
    const theirs = await download(other.cookie);
    expect(theirs.status).toBe(404);
    expect(details(JSON.parse(Buffer.from(theirs.bytes).toString('utf8')))).toEqual([
      'pdf_not_ready',
    ]);
  });

  it('gives the same bytes on a re-run and never serves a file made from details that have changed', async () => {
    const me = await registered('Rerun Student');
    const job = {
      id: 'rerun',
      name: 'render',
      data: { userId: me.user.id, locale: 'en' as const },
    };
    expect(await worker.process(job)).toBe('stored');
    const key = admitCardPdfKey(me.user.id, 'en');
    const [, first] = await cache.hmgetBuffer(key, 'v', 'pdf');
    expect(await worker.process(job)).toBe('stored');
    const [, second] = await cache.hmgetBuffer(key, 'v', 'pdf');
    expect(first && second && first.equals(second)).toBe(true);
    const ttl = await cache.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    // 3 minutes: the cache Redis also holds the sessions and login limits (the lead's review of #45).
    expect(ADMIT_CARD_PDF_TTL_SECONDS).toBe(180);
    expect(ttl).toBeLessThanOrEqual(180);
    expect((await download(me.cookie, 'en')).status).toBe(200);
    // The other language is its own file.
    expect((await download(me.cookie, 'bn')).status).toBe(404);

    // A corrected name: the old print is never served; asking again queues a new one.
    await prisma.user.update({
      where: { id: me.user.id },
      data: { name: 'Rerun Student Corrected' },
    });
    const stale = await download(me.cookie, 'en');
    expect(stale.status).toBe(404);
    expect((await call(env, 'POST', '/admit-card/pdf', me.cookie, { locale: 'en' })).json).toEqual({
      status: 'pending',
    });
    const fresh = await until(
      () => download(me.cookie, 'en'),
      (r) => r.status === 200,
    );
    expect(actualTexts(fresh.bytes).join('')).toContain('Rerun Student Corrected');

    // A re-issued ID (payments P1b): the print with the old ID is never served again.
    await prisma.$executeRaw`
      UPDATE "registrations" SET "participant_id" = gen_participant_id('ON') WHERE "id" = ${me.registration.id}::uuid`;
    expect((await download(me.cookie, 'en')).status).toBe(404);
  });

  it('answers a poll with no file from the cache Redis alone: no database read', async () => {
    const me = await registered('Poll Student');
    const before = env.appPrisma.statements.length;
    const res = await download(me.cookie);
    expect(res.status).toBe(404);
    expect(details(JSON.parse(Buffer.from(res.bytes).toString('utf8')))).toEqual(['pdf_not_ready']);
    // Not one statement: the session's own key is read in the cache Redis, and nothing else.
    expect(env.appPrisma.statements.slice(before)).toEqual([]);

    // With a file there, the card IS re-read (and must still match) before the file is served.
    await worker.process({
      id: 'poll',
      name: 'render',
      data: { userId: me.user.id, locale: 'bn' },
    });
    const reads = env.appPrisma.statements.length;
    expect((await download(me.cookie)).status).toBe(200);
    expect(env.appPrisma.statements.length).toBeGreaterThan(reads);
  });

  it("never queues a second render while the previous minute's job is still pending", async () => {
    // A queue of its own with no worker on it: its jobs stay waiting.
    const name = `admit-card-pdf-idle-${randomUUID().slice(0, 8)}`;
    const config = {
      get: (key: string) => (key === 'ADMIT_CARD_PDF_QUEUE_NAME' ? name : undefined),
    } as unknown as ConfigService<EnvVars, true>;
    const idle = new AdmitCardPdfQueue(env.app.get(REDIS_QUEUE), config);
    const { Queue } = await import('bullmq');
    const inspect = new Queue(name, { connection: env.app.get(REDIS_QUEUE) });
    try {
      const data = { userId: randomUUID(), locale: 'bn' as const };
      const t0 = new Date('2026-11-25T10:00:30Z');
      const t1 = new Date(t0.getTime() + 60_000);
      expect(await idle.render(data, t0)).toBe(true);
      expect(await inspect.getJobState(admitCardPdfJobId(data, t0))).toBe('waiting');
      // A re-click in the next minute: the first job still waits, so nothing new is queued.
      expect(await idle.render(data, t1)).toBe(true);
      expect(await inspect.getJob(admitCardPdfJobId(data, t1))).toBeUndefined();
      expect(await inspect.getWaitingCount()).toBe(1);
      // Once that job is gone (done or failed), the next request queues a fresh render.
      await (await inspect.getJob(admitCardPdfJobId(data, t0)))?.remove();
      expect(await idle.render(data, t1)).toBe(true);
      expect(await inspect.getJobState(admitCardPdfJobId(data, t1))).toBe('waiting');
    } finally {
      await inspect.obliterate({ force: true });
      await inspect.close();
      await idle.onApplicationShutdown();
    }
  });

  it('skips a user who has no admit card now, without a retry or a file', async () => {
    const unpaid = await sessionFor(env, prisma, { role: 'student' });
    const job = { id: 'skip', name: 'render', data: { userId: unpaid.id, locale: 'bn' as const } };
    expect(await worker.process(job)).toBe('skipped');
    expect(await cache.exists(admitCardPdfKey(unpaid.id, 'bn'))).toBe(0);
    await expect(worker.process({ ...job, name: 'other' })).rejects.toThrow(
      /unknown admit card pdf job/,
    );
    await expect(
      worker.process({ ...job, data: { ...job.data, locale: 'fr' as never } }),
    ).rejects.toThrow(/unknown locale/);
  });

  it('is refused without a paid registration, to staff, without a session, and for an unknown language', async () => {
    const unpaid = await sessionFor(env, prisma, { role: 'student' });
    const ask = await call(env, 'POST', '/admit-card/pdf', unpaid.cookie, { locale: 'bn' });
    expect(ask.status).toBe(404);
    expect(details(ask.json)).toEqual(['not_registered']);
    expect((await download(unpaid.cookie)).status).toBe(404);
    expect((await call(env, 'POST', '/admit-card/pdf', '', { locale: 'bn' })).status).toBe(401);
    expect((await download('')).status).toBe(401);
    for (const role of ['admin', 'manager', 'jury'] as const) {
      const staff = await sessionFor(env, prisma, { role });
      expect(
        (await call(env, 'POST', '/admit-card/pdf', staff.cookie, { locale: 'bn' })).status,
      ).toBe(403);
      expect((await download(staff.cookie)).status).toBe(403);
    }
    const me = await registered('Locale Student');
    for (const body of [{ locale: 'fr' }, {}, { locale: 'bn', userId: unpaid.id }])
      expect((await call(env, 'POST', '/admit-card/pdf', me.cookie, body)).status).toBe(400);
    expect((await download(me.cookie, 'fr')).status).toBe(400);
  });
});
