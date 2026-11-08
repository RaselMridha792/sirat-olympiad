/**
 * Certificates (core C6c-1, CORE-PLAN §7; the lead's notes; owner Q4 defaults): the admin's issue run goes through the
 * queue to the worker and is idempotent; participation from Round 1's published snapshot, promotion from a later
 * round's entries, winners named by email in the final; the name copied at issue; the student's own list; revoke
 * (never delete); the public check gives the name and the award only, the same 404 for unknown and revoked, throttled.
 */
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Category, PrismaClient } from '@prisma/client';
import type {
  AdminCertificateRow,
  AdminRound,
  CertificateCheck,
  CertificateIssueResult,
  MyCertificate,
  Paginated,
} from '@sirat/shared';
import type Redis from 'ioredis';
import type { EnvVars } from '../src/config/env';
import { CertificateIssuer } from '../src/modules/certificates/certificate-issuer';
import { CertificatesWorker } from '../src/modules/certificates/certificates.worker';
import type { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CACHE } from '../src/redis/redis.module';
import { bootCoreApp, call, sessionFor, type CoreApp } from './core-helpers';
import { makeAttempt, makePublishedExam } from './exam-helpers';
import { applyReferenceData, testPrisma } from './helpers';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const QUEUE = `certificates-test-${randomUUID().slice(0, 8)}`;

let env: CoreApp;
let prisma: PrismaClient;
let admin: { id: string; cookie: string };
let round1: { id: string };
let issuer: CertificateIssuer;
let redis: Redis;

beforeAll(async () => {
  // The API under test puts its jobs on this run's own queue; the worker below takes them from it.
  process.env.CERTIFICATES_QUEUE_NAME = QUEUE;
  env = await bootCoreApp();
  prisma = testPrisma();
  issuer = new CertificateIssuer(prisma as unknown as PrismaService);
  redis = env.app.get(REDIS_CACHE);
  admin = await sessionFor(env, prisma, { role: 'admin' });
  // Another suite's truncateAll may have emptied the reference data: Round 1 comes back as a deploy makes it.
  if (!(await prisma.round.findUnique({ where: { sortOrder: 1 } })))
    await applyReferenceData(prisma);
  round1 = await prisma.round.findUniqueOrThrow({ where: { sortOrder: 1 }, select: { id: true } });
  await clean();
});

beforeEach(async () => {
  await clean();
  // Every request here comes from one IP: start each test with empty rate-limit counts (the check allows 30 a
  // minute, and an earlier run in the same minute would count).
  const keys = await redis.keys('throttle:*');
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  if (prisma && round1) await clean();
  delete process.env.CERTIFICATES_QUEUE_NAME;
  await env?.app.close();
  await prisma?.$disconnect();
});

/** Rounds are global data: every test starts with Round 1 alone and no certificate (as in rounds.int-spec.ts). */
async function clean() {
  await prisma.$executeRaw`
    UPDATE "exams" SET "status" = 'archived'
    WHERE "round_id" = ${round1.id}::uuid AND "status"::text = 'published'`;
  await prisma.$executeRawUnsafe(
    'TRUNCATE "certificates", "jury_scores", "round_entries", "promotion_runs"',
  );
  await prisma.$executeRaw`DELETE FROM "jury_assignments"`;
  await prisma.$executeRaw`DELETE FROM "rounds" WHERE "sort_order" > 1`;
}

const details = (json: unknown) => (json as { details?: string[] }).details;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const issue = (body: Record<string, unknown>) =>
  call<CertificateIssueResult>(env, 'POST', '/admin/certificates/issue', admin.cookie, body);
const check = (code: string) =>
  call<CertificateCheck>(env, 'GET', `/certificates/verify/${code}`, '');

async function createRound(body: Record<string, unknown>) {
  const res = await call<AdminRound>(env, 'POST', '/admin/rounds', admin.cookie, body);
  expect(res.status).toBe(201);
  return res.json;
}

/** A published Round 1 exam with results published for these students (one snapshot row each). */
async function round1Snapshot(students: Array<{ id: string; category: Category }>) {
  const exam = await makePublishedExam(prisma, {
    roundId: round1.id,
    windowStart: new Date(Date.now() - 3 * HOUR_MS),
    windowEnd: new Date(Date.now() - HOUR_MS),
    graceSeconds: 0,
    questionsPerAttempt: 5,
  });
  let position = 0;
  for (const s of students) {
    const startedAt = new Date(Date.now() - 2 * HOUR_MS);
    const a = await makeAttempt(prisma, s.id, exam.id, {
      startedAt,
      endsAt: new Date(startedAt.getTime() + 30 * 60_000),
      questionCount: 5,
    });
    await prisma.attempt.update({
      where: { id: a.id },
      data: { status: 'submitted', submittedAt: new Date(), timeTakenSeconds: 100 },
    });
    await prisma.attempt.update({ where: { id: a.id }, data: { status: 'scored', score: 3 } });
    position += 1;
    await prisma.leaderboardEntry.create({
      data: {
        examId: exam.id,
        generation: 1,
        position,
        rank: 1,
        userId: s.id,
        attemptId: a.id,
        name: 'Student',
        category: s.category,
        score: 3,
        timeTakenSeconds: 100,
      },
    });
  }
  const now = new Date();
  await prisma.exam.update({
    where: { id: exam.id },
    data: { resultsGeneration: 1, resultsSnapshotAt: now, resultsPublishedAt: now },
  });
  return exam;
}

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('issuing', () => {
  it('issues participation from the published Round 1 snapshot through the queue, once, with the name as it was', async () => {
    const values: Record<string, string> = {
      REDIS_QUEUE_URL: process.env.REDIS_QUEUE_URL as string,
      CERTIFICATES_QUEUE_NAME: QUEUE,
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService<EnvVars, true>;
    const worker = new CertificatesWorker(issuer, config);
    worker.onModuleInit();
    try {
      const a = await sessionFor(env, prisma, {
        role: 'student',
        category: 'activist',
        name: 'Nusrat Jahan',
      });
      const b = await sessionFor(env, prisma, {
        role: 'student',
        category: 'achiever',
        name: 'Rahim Uddin',
      });
      const blocked = await sessionFor(env, prisma, { role: 'student', category: 'activist' });
      await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
      await round1Snapshot([
        { id: a.id, category: 'activist' },
        { id: b.id, category: 'achiever' },
        { id: blocked.id, category: 'activist' },
      ]);

      const res = await issue({ type: 'participation', roundId: round1.id });
      expect([res.status, res.json]).toEqual([
        202,
        { queued: true, type: 'participation', roundId: round1.id, candidates: 2 },
      ]);
      const issued = await until(
        () => prisma.certificate.findMany({ where: { type: 'participation', roundId: round1.id } }),
        (rows) => rows.length >= 2,
      );
      expect(issued.map((c) => c.userId).sort()).toEqual([a.id, b.id].sort());
      for (const c of issued) {
        expect(c.serial).toMatch(/^SLO-\d{4}-\d{6,}$/);
        expect(c.verificationCode).toMatch(/^[0-9A-F]{12}$/);
      }
      expect(issued.find((c) => c.userId === a.id)!.nameOnCertificate).toBe('Nusrat Jahan');

      // Run twice: nothing new. A later name change does not touch an issued certificate.
      await prisma.user.update({ where: { id: a.id }, data: { name: 'Nusrat J. Rahman' } });
      await issue({ type: 'participation', roundId: round1.id });
      const audits = await until(
        () =>
          prisma.auditLog.findMany({
            where: { action: 'certificates.issued', entityId: round1.id, actorId: admin.id },
          }),
        (rows) => rows.length >= 2,
      );
      expect(audits.map((r) => (r.meta as { issued: number }).issued).sort()).toEqual([0, 2]);
      expect(await prisma.certificate.count({ where: { roundId: round1.id } })).toBe(2);
      const mine = await call<MyCertificate[]>(env, 'GET', '/certificates/mine', a.cookie);
      expect(mine.json).toEqual([
        expect.objectContaining({
          type: 'participation',
          nameOnCertificate: 'Nusrat Jahan',
          revoked: false,
        }),
      ]);
    } finally {
      await worker.onApplicationShutdown();
    }
  });

  it('issues promotion for a later round and winners named by email in the final; refuses the wrong kinds', async () => {
    const video = await createRound({
      name: 'Video round',
      type: 'video',
      opensAt: iso(-HOUR_MS),
      closesAt: iso(DAY_MS),
    });
    const final = await createRound({ name: 'Final', type: 'final' });
    const a = await sessionFor(env, prisma, { role: 'student', category: 'activist' });
    const b = await sessionFor(env, prisma, { role: 'student', category: 'activist' });
    await prisma.roundEntry.createMany({
      data: [
        { userId: a.id, roundId: video.id },
        { userId: b.id, roundId: video.id },
        { userId: a.id, roundId: final.id },
      ],
    });
    const aEmail = (await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).email;
    const bEmail = (await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).email;

    expect((await issue({ type: 'promotion', roundId: video.id })).json.candidates).toBe(2);
    expect(
      await issuer.issue({ type: 'promotion', roundId: video.id, requestedBy: admin.id }),
    ).toBe(2);
    const winner = await issue({
      type: 'winner',
      roundId: final.id,
      emails: [aEmail.toUpperCase()],
      reason: 'Overall winner',
    });
    expect([winner.status, winner.json.candidates]).toEqual([202, 1]);
    expect(
      await issuer.issue({
        type: 'winner',
        roundId: final.id,
        userIds: [a.id],
        requestedBy: admin.id,
      }),
    ).toBe(1);
    expect(await prisma.certificate.count({ where: { userId: a.id } })).toBe(2);
    const requested = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'certificates.issue_requested', entityId: final.id },
    });
    expect(requested.meta).toMatchObject({ type: 'winner', winners: 1, reason: 'Overall winner' });
    expect(JSON.stringify(requested.meta)).not.toContain('@');

    const refusals: Array<[Record<string, unknown>, number, string]> = [
      [{ type: 'participation', roundId: video.id }, 409, 'wrong_round'],
      [{ type: 'participation', roundId: round1.id }, 409, 'results_not_published'],
      [{ type: 'promotion', roundId: round1.id }, 409, 'wrong_round'],
      [
        { type: 'winner', roundId: video.id, emails: [aEmail], reason: 'Winner' },
        409,
        'wrong_round',
      ],
      [{ type: 'winner', roundId: final.id }, 400, 'no_winners'],
      [{ type: 'winner', roundId: final.id, emails: [aEmail] }, 400, 'no_winners'],
      [{ type: 'promotion', roundId: video.id, emails: [aEmail] }, 400, 'no_winners'],
      [
        { type: 'winner', roundId: final.id, emails: ['nobody@example.org'], reason: 'Winner' },
        409,
        'unknown_user',
      ],
      [
        { type: 'winner', roundId: final.id, emails: [bEmail], reason: 'Winner' },
        409,
        'not_in_round',
      ],
    ];
    for (const [body, status, code] of refusals) {
      const res = await issue(body);
      expect([res.status, details(res.json)]).toEqual([status, [code]]);
    }
    for (const body of [
      { type: 'medal', roundId: final.id },
      { type: 'winner', roundId: 'x' },
      { type: 'winner', roundId: final.id, emails: ['not-an-email'], reason: 'Winner' },
    ])
      expect((await issue(body)).status).toBe(400);
    expect((await issue({ type: 'promotion', roundId: randomUUID() })).status).toBe(404);
  });
});

describe('the check and the revoke', () => {
  it('shows the name and the award only; revoked and unknown codes get the same 404', async () => {
    const final = await createRound({ name: 'Final', type: 'final' });
    const s = await sessionFor(env, prisma, { role: 'student', name: 'Nusrat Jahan' });
    await prisma.roundEntry.create({ data: { userId: s.id, roundId: final.id } });
    await issuer.issue({ type: 'promotion', roundId: final.id, requestedBy: admin.id });
    const cert = await prisma.certificate.findFirstOrThrow({ where: { userId: s.id } });

    const ok = await check(cert.verificationCode.toLowerCase());
    expect([ok.status, ok.json]).toEqual([
      200,
      { name: 'Nusrat Jahan', award: { type: 'promotion', roundName: 'Final' }, demo: false },
    ]);
    const unknown = await check('ABCDEF012345');
    const malformed = await check('not-a-code');
    expect([unknown.status, malformed.status]).toEqual([404, 404]);

    const list = await call<Paginated<AdminCertificateRow>>(
      env,
      'GET',
      `/admin/certificates?q=${encodeURIComponent('nusrat')}&type=promotion`,
      admin.cookie,
    );
    expect(list.json.items.map((r) => r.id)).toContain(cert.id);
    const bySerial = await call<Paginated<AdminCertificateRow>>(
      env,
      'GET',
      `/admin/certificates?q=${cert.serial.toLowerCase()}`,
      admin.cookie,
    );
    expect(bySerial.json.items.map((r) => r.id)).toEqual([cert.id]);
    const row = list.json.items.find((r) => r.id === cert.id)!;
    const revoke = (body: Record<string, unknown>) =>
      call<AdminCertificateRow>(
        env,
        'POST',
        `/admin/certificates/${cert.id}/revoke`,
        admin.cookie,
        body,
      );
    expect(
      details((await revoke({ reason: 'Wrong', expectedUpdatedAt: iso(-DAY_MS) })).json),
    ).toEqual(['stale']);
    const done = await revoke({ reason: 'Issued by mistake', expectedUpdatedAt: row.updatedAt });
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({
      revokeReason: 'Issued by mistake',
      revokedAt: expect.any(String),
    });
    expect(
      details((await revoke({ reason: 'Again', expectedUpdatedAt: done.json.updatedAt })).json),
    ).toEqual(['already_revoked']);
    expect((await revoke({ reason: 'x', expectedUpdatedAt: done.json.updatedAt })).status).toBe(
      400,
    );

    const gone = await check(cert.verificationCode);
    // The same answer as an unknown code, apart from the request's own id.
    const body = (r: { json: unknown }) => ({ ...(r.json as object), requestId: undefined });
    expect([gone.status, body(gone)]).toEqual([unknown.status, body(unknown)]);
    expect(body(malformed)).toEqual(body(unknown));
    const mine = await call<MyCertificate[]>(env, 'GET', '/certificates/mine', s.cookie);
    expect(mine.json[0]).toMatchObject({ id: cert.id, revoked: true });
    expect(JSON.stringify(mine.json)).not.toContain('Issued by mistake');
    expect(
      await prisma.auditLog.count({ where: { action: 'certificate.revoked', entityId: cert.id } }),
    ).toBe(1);
  });

  it('limits the public check per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 35; i += 1) statuses.push((await check('ABCDEF012345')).status);
    // 30 a minute per IP (other checks of this run in the same minute count too): then 429, never anything else.
    expect(statuses).toContain(429);
    expect(statuses.filter((code) => code !== 404 && code !== 429)).toEqual([]);
    expect(statuses.slice(statuses.indexOf(429)).every((code) => code === 429)).toBe(true);
  });
});

describe('access and the database rules', () => {
  it('is for admins only; the own list for students and ambassadors', async () => {
    for (const role of ['manager', 'jury', 'student', 'ambassador'] as const) {
      const s = await sessionFor(env, prisma, { role });
      expect((await call(env, 'GET', '/admin/certificates', s.cookie)).status).toBe(403);
      expect((await call(env, 'POST', '/admin/certificates/issue', s.cookie, {})).status).toBe(403);
    }
    expect((await call(env, 'GET', '/certificates/mine', admin.cookie)).status).toBe(403);
    const demoted = await sessionFor(env, prisma, { role: 'admin' });
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'manager' } });
    expect((await call(env, 'GET', '/admin/certificates', demoted.cookie)).status).toBe(403);
    expect(
      (
        await call(env, 'POST', '/admin/certificates/issue', demoted.cookie, {
          type: 'promotion',
          roundId: round1.id,
        })
      ).status,
    ).toBe(403);
    expect((await call(env, 'GET', '/certificates/mine', '')).status).toBe(401);
  });

  it('keeps the rules in the database too', async () => {
    const s = await sessionFor(env, prisma, { role: 'student' });
    const base = {
      userId: s.id,
      roundId: round1.id,
      type: 'participation',
      serial: 'SLO-2026-999999',
      verificationCode: 'ABCDEF012345',
      nameOnCertificate: 'Name',
    };
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ type: 'medal' }, 'certificates_type_check'],
      [{ serial: 'X-1' }, 'certificates_serial_check'],
      [{ verificationCode: 'abcdef012345' }, 'certificates_verification_code_check'],
      [{ nameOnCertificate: '' }, 'certificates_name_check'],
      [{ revokedAt: new Date() }, 'certificates_revoke_check'],
      [
        { revokedAt: new Date(), revokedById: admin.id, revokeReason: 'x' },
        'certificates_revoke_reason_check',
      ],
    ];
    for (const [data, name] of cases)
      await expect(
        prisma.certificate.create({ data: { ...base, ...data } as never }),
      ).rejects.toThrow(name);
    await prisma.certificate.create({ data: base });
    await expect(
      prisma.certificate.create({
        data: { ...base, serial: 'SLO-2026-999998', verificationCode: 'ABCDEF012346' },
      }),
    ).rejects.toThrow(/Unique constraint|user_id/);
  });
});
