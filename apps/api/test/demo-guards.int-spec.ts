/**
 * Demo data never mixes with real data in core's services (DECISIONS 2026-11-08 "Demo data"; phase 2, the lead's
 * approval of 2026-11-09). Each guard both ways:
 * - tasks: a demo task goes only to demo ambassadors and a real one only to real ones, all or nothing
 *   (task_side_mismatch), and the task_assignments trigger refuses a mix whoever writes it;
 * - rounds: no real round is added and no promotion runs while demo rounds exist (demo_rounds_present); a real
 *   promotion never takes a demo exam on the real Round 1;
 * - student reads by side (/rounds/me, the video), and the round_entries trigger refuses an entry on the other side;
 * - jury: a judge goes only on a round of its side (jury_side_mismatch) and sees and scores only its side's entries;
 * - certificates: no issue run on a demo round (demo_round), eligible() leaves demo accounts and exams out, and a demo
 *   certificate is marked in the admin list and in the public check;
 * - the admin lists mark demo rows; admin stats count real rounds first.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Category, PrismaClient, RoundType } from '@prisma/client';
import {
  CATEGORIES,
  DEFAULT_VIDEO_CRITERIA,
  type AdminAmbassadorRow,
  type AdminCertificateRow,
  type AdminRound,
  type AdminRoundJury,
  type AdminStats,
  type AdminTaskReviewRow,
  type AdminTaskRow,
  type AdminTeamRow,
  type CertificateCheck,
  type JuryEntryRow,
  type JuryRound,
  type MyRound,
  type MyTeam,
  type Paginated,
  type PromotionPreview,
  type TaskAssignResult,
} from '@sirat/shared';
import type Redis from 'ioredis';
import { STATS_KEY } from '../src/modules/admin/admin-stats.service';
import { newPromoCode } from '../src/modules/ambassadors/promo-code';
import { CertificateIssuer } from '../src/modules/certificates/certificate-issuer';
import type { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CACHE } from '../src/redis/redis.module';
import { bootCoreApp, call, sessionFor, type CoreApp } from './core-helpers';
import { makeAttempt, makePublishedExam } from './exam-helpers';
import { applyReferenceData, testPrisma } from './helpers';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DOMAIN = '@demo.sirat.invalid';
const CATEGORY: Category = CATEGORIES[0];

let env: CoreApp;
let prisma: PrismaClient;
let redis: Redis;
let admin: { id: string; cookie: string };
let round1: { id: string };
let batchId: string;

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  redis = env.app.get(REDIS_CACHE);
  admin = await sessionFor(env, prisma, { role: 'admin' });
  // Another suite's truncateAll may have emptied the reference data: Round 1 comes back as a deploy makes it.
  if (!(await prisma.round.findUnique({ where: { sortOrder: 1 } })))
    await applyReferenceData(prisma);
  round1 = await prisma.round.findUniqueOrThrow({ where: { sortOrder: 1 }, select: { id: true } });
  // One batch at a time (a unique index): this suite's demo rows all belong to it, and it goes in afterAll.
  batchId = (
    await prisma.demoBatch.create({ data: { status: 'loaded', reason: 'Core guards test' } })
  ).id;
  await clean();
});

beforeEach(() => clean());

afterAll(async () => {
  if (prisma && round1) await clean();
  if (prisma && batchId) await clearBatch();
  await env?.app.close();
  await prisma?.$disconnect();
});

/** Rounds are global data: every test starts with the real Round 1 alone (as in rounds.int-spec.ts). */
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

/** Registers every root this suite marked, then removes the batch the one way demo rows go (demo_clear). */
async function clearBatch() {
  const roots = [
    [
      'users',
      await prisma.user.findMany({ where: { demoBatchId: batchId }, select: { id: true } }),
    ],
    [
      'exams',
      await prisma.exam.findMany({ where: { demoBatchId: batchId }, select: { id: true } }),
    ],
    [
      'admin_tasks',
      await prisma.adminTask.findMany({ where: { demoBatchId: batchId }, select: { id: true } }),
    ],
    [
      'rounds',
      await prisma.round.findMany({ where: { demoBatchId: batchId }, select: { id: true } }),
    ],
  ] as const;
  for (const [table, rows] of roots)
    await prisma.demoRecord.createMany({
      data: rows.map((r) => ({ batchId, tableName: table, rowId: r.id })),
      skipDuplicates: true,
    });
  await prisma.$queryRaw`SELECT demo_clear(${batchId}::uuid)`;
}

const details = (json: unknown) => (json as { details?: string[] }).details;
const short = () => randomUUID().slice(0, 8);

/** A signed-in account on one side: demo accounts carry the batch and the marker domain. */
const person = (demo: boolean, role: 'student' | 'ambassador' | 'jury', extra = {}) =>
  sessionFor(env, prisma, {
    role,
    category: CATEGORY,
    ...(demo ? { email: `${role}-${short()}${DOMAIN}`, demoBatchId: batchId } : {}),
    ...extra,
  });

async function ambassador(demo: boolean) {
  const s = await person(demo, 'ambassador');
  await prisma.ambassadorProfile.create({
    data: { userId: s.id, promoCode: newPromoCode(), approvedAt: new Date() },
  });
  return s;
}

/** A round written as the loader or the service writes it; demo rounds use the 101-110 sort orders. */
function round(
  demo: boolean,
  type: RoundType,
  sortOrder: number,
  window: { opensAt?: Date; closesAt?: Date } = {},
) {
  return prisma.round.create({
    data: {
      name: `${demo ? 'Demo ' : ''}${type} ${short()}`,
      type,
      sortOrder,
      opensAt: window.opensAt ?? null,
      closesAt: window.closesAt ?? null,
      criteria: type === 'video' ? DEFAULT_VIDEO_CRITERIA.map((c) => ({ ...c })) : undefined,
      demoBatchId: demo ? batchId : null,
    },
  });
}
const open = () => ({
  opensAt: new Date(Date.now() - HOUR_MS),
  closesAt: new Date(Date.now() + DAY_MS),
});
const closed = () => ({
  opensAt: new Date(Date.now() - 2 * DAY_MS),
  closesAt: new Date(Date.now() - HOUR_MS),
});

/** A published exam on a round with these students on its published results snapshot. */
async function snapshot(roundId: string, students: string[], demo = false) {
  const exam = await makePublishedExam(prisma, {
    roundId,
    windowStart: new Date(Date.now() - 3 * HOUR_MS),
    windowEnd: new Date(Date.now() - HOUR_MS),
    graceSeconds: 0,
    questionsPerAttempt: 5,
    ...(demo ? { demoBatchId: batchId, title: `DEMO · Round 1 ${short()}` } : {}),
  });
  let position = 0;
  for (const userId of students) {
    const startedAt = new Date(Date.now() - 2 * HOUR_MS);
    const a = await makeAttempt(prisma, userId, exam.id, {
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
        userId,
        attemptId: a.id,
        name: 'Student',
        category: CATEGORY,
        score: 3,
        timeTakenSeconds: 100,
      },
    });
  }
  const now = new Date();
  return prisma.exam.update({
    where: { id: exam.id },
    data: { resultsGeneration: 1, resultsSnapshotAt: now, resultsPublishedAt: now },
  });
}

// ───────────── Tasks ─────────────

describe('tasks', () => {
  const assign = (taskId: string, userIds: string[]) =>
    call<TaskAssignResult>(env, 'POST', `/admin/tasks/${taskId}/assign`, admin.cookie, {
      userIds,
    });
  async function realTask() {
    const res = await call<AdminTaskRow>(env, 'POST', '/admin/tasks', admin.cookie, {
      title: `Real task ${short()}`,
      description: 'Share the poster.',
      points: 10,
    });
    expect(res.status).toBe(201);
    return res.json;
  }
  const demoTask = () =>
    prisma.adminTask.create({
      data: {
        title: `Demo task ${short()}`,
        description: 'Share the poster.',
        points: 10,
        createdById: admin.id,
        demoBatchId: batchId,
      },
    });
  const assignments = (taskId: string) => prisma.taskAssignment.count({ where: { taskId } });

  it('a real task goes to real ambassadors only, all or nothing', async () => {
    const [task, real, demo] = await Promise.all([realTask(), ambassador(false), ambassador(true)]);
    for (const ids of [[demo.id], [real.id, demo.id]]) {
      const res = await assign(task.id, ids);
      expect(res.status).toBe(409);
      expect(details(res.json)).toEqual(['task_side_mismatch']);
    }
    expect(await assignments(task.id)).toBe(0);
    const ok = await assign(task.id, [real.id]);
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ assigned: 1, alreadyAssigned: 0 });
  });

  it('a demo task goes to demo ambassadors only', async () => {
    const [task, real, demo] = await Promise.all([demoTask(), ambassador(false), ambassador(true)]);
    const refused = await assign(task.id, [real.id]);
    expect(refused.status).toBe(409);
    expect(details(refused.json)).toEqual(['task_side_mismatch']);
    expect(await assignments(task.id)).toBe(0);
    const ok = await assign(task.id, [demo.id]);
    expect(ok.status).toBe(200);
    expect(ok.json.assigned).toBe(1);
  });

  it('the database refuses an assignment on the other side, whoever writes it', async () => {
    const [real, demo, realOne, demoOne] = await Promise.all([
      realTask(),
      demoTask(),
      ambassador(false),
      ambassador(true),
    ]);
    await expect(
      prisma.taskAssignment.create({ data: { taskId: real.id, userId: demoOne.id } }),
    ).rejects.toThrow(/task_side_mismatch/);
    await expect(
      prisma.taskAssignment.create({ data: { taskId: demo.id, userId: realOne.id } }),
    ).rejects.toThrow(/task_side_mismatch/);
    // The same side passes, and a later move to the other side is refused too.
    const ok = await prisma.taskAssignment.create({
      data: { taskId: demo.id, userId: demoOne.id },
    });
    await expect(
      prisma.taskAssignment.update({ where: { id: ok.id }, data: { userId: realOne.id } }),
    ).rejects.toThrow(/task_side_mismatch/);
  });

  it('the admin lists mark demo tasks and their proofs', async () => {
    const [real, demo, realOne, demoOne] = await Promise.all([
      realTask(),
      demoTask(),
      ambassador(false),
      ambassador(true),
    ]);
    const submitted = { status: 'submitted' as const, proofText: 'Done.', submittedAt: new Date() };
    const a = await prisma.taskAssignment.create({
      data: { taskId: real.id, userId: realOne.id, ...submitted },
    });
    const b = await prisma.taskAssignment.create({
      data: { taskId: demo.id, userId: demoOne.id, ...submitted },
    });
    const list = await call<Paginated<AdminTaskRow>>(
      env,
      'GET',
      '/admin/tasks?pageSize=50',
      admin.cookie,
    );
    expect(list.status).toBe(200);
    const row = (id: string) => list.json.items.find((t) => t.id === id);
    expect([row(real.id)?.demo, row(demo.id)?.demo]).toEqual([false, true]);
    const queue = await call<Paginated<AdminTaskReviewRow>>(
      env,
      'GET',
      '/admin/task-assignments?pageSize=50',
      admin.cookie,
    );
    expect(queue.status).toBe(200);
    const proof = (id: string) => queue.json.items.find((r) => r.assignmentId === id);
    expect([proof(a.id)?.demo, proof(b.id)?.demo]).toEqual([false, true]);
  });
});

// ───────────── Rounds and promotion ─────────────

describe('rounds and promotion', () => {
  const create = () =>
    call<AdminRound>(env, 'POST', '/admin/rounds', admin.cookie, {
      name: `Video ${short()}`,
      type: 'video',
      opensAt: new Date(Date.now() + DAY_MS).toISOString(),
      closesAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
    });
  const preview = () =>
    call<PromotionPreview>(
      env,
      'POST',
      `/admin/rounds/${round1.id}/promotion/preview`,
      admin.cookie,
      { category: CATEGORY, topN: 5 },
    );
  const run = () =>
    call(env, 'POST', `/admin/rounds/${round1.id}/promotion`, admin.cookie, {
      category: CATEGORY,
      topN: 5,
      expected: { promoted: 1, sourceKey: 'x' },
    });
  const dropDemoRounds = () => prisma.round.deleteMany({ where: { demoBatchId: batchId } });

  it('no real round is added while demo rounds exist; the list marks them', async () => {
    const demo = await round(true, 'quiz', 101);
    const refused = await create();
    expect(refused.status).toBe(409);
    expect(details(refused.json)).toEqual(['demo_rounds_present']);
    const list = await call<{ items: AdminRound[] }>(env, 'GET', '/admin/rounds', admin.cookie);
    const mark = (id: string) => list.json.items.find((r) => r.id === id)?.demo;
    expect([mark(round1.id), mark(demo.id)]).toEqual([false, true]);

    await dropDemoRounds();
    const ok = await create();
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ sortOrder: 2, demo: false });
  });

  it('no promotion is previewed or run while demo rounds exist', async () => {
    await round(true, 'quiz', 101);
    for (const res of [await preview(), await run()]) {
      expect(res.status).toBe(409);
      expect(details(res.json)).toEqual(['demo_rounds_present']);
    }
    await dropDemoRounds();
    const after = await preview();
    expect(after.status).toBe(409);
    expect(details(after.json)).toEqual(['no_next_round']);
  });

  it('a real promotion takes the real Round 1 exam, never a demo exam on it', async () => {
    const [real, demo] = await Promise.all([person(false, 'student'), person(true, 'student')]);
    await round(false, 'video', 2, {
      opensAt: new Date(Date.now() + DAY_MS),
      closesAt: new Date(Date.now() + 2 * DAY_MS),
    });
    const exam = await snapshot(round1.id, [real.id]);
    // Phase 1's shape: the demo exam on the real Round 1 (published, results published).
    await snapshot(round1.id, [demo.id], true);
    const res = await preview();
    expect(res.status).toBe(200);
    expect(res.json.source).toMatchObject({ kind: 'exam', examId: exam.id });
    expect(res.json.candidates).toBe(1);
  });
});

// ───────────── Student reads ─────────────

describe('student reads by side', () => {
  const mine = (cookie: string) => call<MyRound>(env, 'GET', '/rounds/me', cookie);

  it('/rounds/me: a real student sees the real Round 1, a demo student its demo rounds', async () => {
    const demo1 = await round(true, 'quiz', 101);
    const demo2 = await round(true, 'video', 102, open());
    const [real, fresh, promoted] = await Promise.all([
      person(false, 'student'),
      person(true, 'student'),
      person(true, 'student'),
    ]);
    await prisma.roundEntry.create({ data: { userId: promoted.id, roundId: demo2.id } });
    expect((await mine(real.cookie)).json.round.id).toBe(round1.id);
    expect((await mine(fresh.cookie)).json.round.id).toBe(demo1.id);
    expect((await mine(promoted.cookie)).json.round.id).toBe(demo2.id);
  });

  it('a real student never sends a video to a demo round', async () => {
    const demo = await round(true, 'video', 102, open());
    const [real, demoOne] = await Promise.all([person(false, 'student'), person(true, 'student')]);
    await prisma.roundEntry.create({ data: { userId: demoOne.id, roundId: demo.id } });
    const url = 'https://youtu.be/abcdefgh123';
    const refused = await call(env, 'PUT', `/rounds/${demo.id}/video`, real.cookie, { url });
    expect(refused.status).toBe(404);
    const ok = await call<MyRound>(env, 'PUT', `/rounds/${demo.id}/video`, demoOne.cookie, { url });
    expect(ok.status).toBe(200);
    expect(ok.json.entryStatus).toBe('submitted');
  });

  it('the database refuses an entry on the other side, whoever writes it', async () => {
    const demo = await round(true, 'video', 102, open());
    const [real, demoOne] = await Promise.all([person(false, 'student'), person(true, 'student')]);
    await expect(
      prisma.roundEntry.create({ data: { userId: real.id, roundId: demo.id } }),
    ).rejects.toThrow(/round_side_mismatch/);
    await expect(
      prisma.roundEntry.create({ data: { userId: demoOne.id, roundId: round1.id } }),
    ).rejects.toThrow(/round_side_mismatch/);
    const ok = await prisma.roundEntry.create({ data: { userId: real.id, roundId: round1.id } });
    await expect(
      prisma.roundEntry.update({ where: { id: ok.id }, data: { roundId: demo.id } }),
    ).rejects.toThrow(/round_side_mismatch/);
  });
});

// ───────────── Jury ─────────────

describe('jury', () => {
  const assign = (roundId: string, judgeId: string) =>
    call(env, 'POST', `/admin/rounds/${roundId}/jury`, admin.cookie, {
      judgeId,
      categories: [CATEGORY],
    });
  const scores = Object.fromEntries(DEFAULT_VIDEO_CRITERIA.map((c) => [c.key, 7]));

  it('a judge goes only on a round of its side; the candidates follow the round', async () => {
    const demo = await round(true, 'video', 102, open());
    const real = await round(false, 'video', 2, open());
    // First by name, so the 200-candidate list always holds them whatever other suites left behind.
    const [realJudge, demoJudge] = await Promise.all([
      person(false, 'jury', { name: 'Aaa Guard Judge' }),
      person(true, 'jury', { name: 'Aaa Guard Judge' }),
    ]);
    for (const [roundId, judgeId] of [
      [demo.id, realJudge.id],
      [real.id, demoJudge.id],
    ] as const) {
      const res = await assign(roundId, judgeId);
      expect(res.status).toBe(409);
      expect(details(res.json)).toEqual(['jury_side_mismatch']);
    }
    expect((await assign(demo.id, demoJudge.id)).status).toBe(200);
    expect((await assign(real.id, realJudge.id)).status).toBe(200);

    const jury = async (id: string) =>
      (await call<AdminRoundJury>(env, 'GET', `/admin/rounds/${id}/jury`, admin.cookie)).json;
    const [d, r] = [await jury(demo.id), await jury(real.id)];
    expect([d.round.demo, r.round.demo]).toEqual([true, false]);
    const ids = (j: AdminRoundJury) => j.candidates.map((c) => c.userId);
    expect(ids(d)).toContain(demoJudge.id);
    expect(ids(d)).not.toContain(realJudge.id);
    expect(ids(r)).toContain(realJudge.id);
    expect(ids(r)).not.toContain(demoJudge.id);
  });

  it("a judge sees and scores only its side's entries", async () => {
    const demo = await round(true, 'video', 102, closed());
    const [realJudge, demoJudge, student] = await Promise.all([
      person(false, 'jury'),
      person(true, 'jury'),
      person(true, 'student'),
    ]);
    const entry = await prisma.roundEntry.create({
      data: {
        userId: student.id,
        roundId: demo.id,
        status: 'submitted',
        videoUrl: 'https://youtu.be/abcdefgh123',
        videoSubmittedAt: new Date(Date.now() - 2 * HOUR_MS),
      },
    });
    // A real judge on the demo round can only be written by hand (the service refuses it): even then it sees nothing.
    const wrong = await prisma.juryAssignment.create({
      data: { roundId: demo.id, judgeId: realJudge.id, category: CATEGORY, createdById: admin.id },
    });
    const rounds = await call<JuryRound[]>(env, 'GET', '/jury/rounds', realJudge.cookie);
    expect(rounds.json.map((r) => r.id)).not.toContain(demo.id);
    const list = await call(env, 'GET', `/jury/entries?round=${demo.id}`, realJudge.cookie);
    expect(list.status).toBe(404);
    const score = await call(env, 'POST', `/jury/entries/${entry.id}/scores`, realJudge.cookie, {
      criteria: scores,
    });
    expect(score.status).toBe(404);
    await prisma.juryAssignment.delete({ where: { id: wrong.id } });

    expect((await assign(demo.id, demoJudge.id)).status).toBe(200);
    const own = await call<JuryRound[]>(env, 'GET', '/jury/rounds', demoJudge.cookie);
    expect(own.json.map((r) => r.id)).toEqual([demo.id]);
    const entries = await call<Paginated<JuryEntryRow>>(
      env,
      'GET',
      `/jury/entries?round=${demo.id}`,
      demoJudge.cookie,
    );
    expect(entries.json.items.map((e) => e.entryId)).toEqual([entry.id]);
    const scored = await call(env, 'POST', `/jury/entries/${entry.id}/scores`, demoJudge.cookie, {
      criteria: scores,
    });
    expect(scored.status).toBe(201);
  });
});

// ───────────── Certificates ─────────────

describe('certificates', () => {
  const issue = (body: Record<string, unknown>) =>
    call(env, 'POST', '/admin/certificates/issue', admin.cookie, body);

  it('an issue run refuses a demo round; a demo exam never makes Round 1 count as published', async () => {
    const demo = await round(true, 'video', 102, closed());
    const refused = await issue({ type: 'promotion', roundId: demo.id });
    expect(refused.status).toBe(409);
    expect(details(refused.json)).toEqual(['demo_round']);
    // A demo exam with published results on the real Round 1: the real round still has none.
    await snapshot(round1.id, [(await person(true, 'student')).id], true);
    const real = await issue({ type: 'participation', roundId: round1.id });
    expect(real.status).toBe(409);
    expect(details(real.json)).toEqual(['results_not_published']);
  });

  it('eligible() leaves demo accounts and demo exams out', async () => {
    const [real, demo, demoOther, realOnDemo] = await Promise.all([
      person(false, 'student'),
      person(true, 'student'),
      person(true, 'student'),
      person(false, 'student'),
    ]);
    try {
      // A demo account on the real exam's snapshot, and a demo exam on the real Round 1 (with a real account on it,
      // so the exam rule is tested on its own): neither counts.
      await snapshot(round1.id, [real.id, demo.id]);
      await snapshot(round1.id, [demoOther.id, realOnDemo.id], true);
      const issuer = new CertificateIssuer(prisma as unknown as PrismaService);
      expect(
        await issuer.candidates(prisma as unknown as PrismaService, {
          type: 'participation',
          roundId: round1.id,
        }),
      ).toBe(1);
    } finally {
      // The demo account's attempt on the real exam would block demo_clear: TRUNCATE is this *_test database's way
      // out (as in demo-clear.int-spec.ts).
      await prisma.$executeRawUnsafe('TRUNCATE "attempts" CASCADE');
    }
  });

  it('the admin list and the public check mark a demo certificate', async () => {
    const final = await round(true, 'final', 103);
    const [real, demo] = await Promise.all([person(false, 'student'), person(true, 'student')]);
    await prisma.roundEntry.create({ data: { userId: demo.id, roundId: final.id } });
    const year = new Date().getFullYear();
    const cert = (userId: string, roundId: string, serial: string) =>
      prisma.certificate.create({
        data: {
          userId,
          roundId,
          type: roundId === round1.id ? 'participation' : 'winner',
          serial,
          verificationCode: randomBytes(6).toString('hex').toUpperCase(),
          nameOnCertificate: 'Student',
        },
      });
    const six = () => String(100_000 + Math.floor(Math.random() * 700_000));
    const r = await cert(real.id, round1.id, `SLO-${year}-${six()}`);
    const d = await cert(demo.id, final.id, `SLO-${year}-9${six().slice(1)}`);

    for (const [c, demoFlag] of [
      [r, false],
      [d, true],
    ] as const) {
      const list = await call<Paginated<AdminCertificateRow>>(
        env,
        'GET',
        `/admin/certificates?q=${c.serial}`,
        admin.cookie,
      );
      expect(list.json.items.map((i) => [i.id, i.demo])).toEqual([[c.id, demoFlag]]);
      const check = await call<CertificateCheck>(
        env,
        'GET',
        `/certificates/verify/${c.verificationCode}`,
        '',
      );
      expect(check.status).toBe(200);
      expect(check.json.demo).toBe(demoFlag);
    }
  });
});

// ───────────── Admin lists and stats ─────────────

describe('admin lists and stats', () => {
  it('mark demo ambassadors and demo teams', async () => {
    const [real, demo] = await Promise.all([ambassador(false), ambassador(true)]);
    const team = async (cookie: string) =>
      (await call<MyTeam>(env, 'POST', '/ambassador/teams', cookie, { name: `Team ${short()}` }))
        .json;
    const [realTeam, demoTeam] = [await team(real.cookie), await team(demo.cookie)];
    for (const [id, teamName, flag] of [
      [real.id, realTeam.name, false],
      [demo.id, demoTeam.name, true],
    ] as const) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } });
      const ambassadors = await call<Paginated<AdminAmbassadorRow>>(
        env,
        'GET',
        `/admin/ambassadors?q=${encodeURIComponent(user.email)}`,
        admin.cookie,
      );
      expect(ambassadors.json.items.map((a) => [a.userId, a.demo])).toEqual([[id, flag]]);
      const teams = await call<Paginated<AdminTeamRow>>(
        env,
        'GET',
        `/admin/teams?q=${encodeURIComponent(teamName)}`,
        admin.cookie,
      );
      expect(teams.json.items.map((t) => t.demo)).toEqual([flag]);
    }
  });

  it('stats count the real second round and final first, demo ones only while no real one exists', async () => {
    const stats = async () => {
      await redis.del(STATS_KEY);
      return (await call<AdminStats>(env, 'GET', '/admin/stats', admin.cookie)).json.totals;
    };
    await round(true, 'quiz', 101);
    const demo2 = await round(true, 'video', 102, closed());
    const demoFinal = await round(true, 'final', 103);
    const students = await Promise.all([1, 2, 3].map(() => person(true, 'student')));
    await prisma.roundEntry.createMany({
      data: [
        { userId: students[0]!.id, roundId: demo2.id },
        { userId: students[1]!.id, roundId: demo2.id },
        { userId: students[2]!.id, roundId: demoFinal.id },
      ],
    });
    expect(await stats()).toMatchObject({ secondRound: 2, finalists: 1 });

    const real2 = await round(false, 'video', 2, open());
    await prisma.roundEntry.create({
      data: { userId: (await person(false, 'student')).id, roundId: real2.id },
    });
    // The real second round counts now; the final is still the demo one, as there is no real final.
    expect(await stats()).toMatchObject({ secondRound: 1, finalists: 1 });
  });
});
