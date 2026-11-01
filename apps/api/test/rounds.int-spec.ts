/**
 * Rounds and promotion (core C6a, CORE-PLAN §7; lead's review 2026-11-01): rounds as data after Round 1, the window
 * and criteria rules, promotion of the top N per category from Round 1's published snapshot (ranked inside the
 * category, ties at the cut included) and from a video round's jury averages, one run per round and category, the
 * preview's `expected`, nothing overwritten, the student's own round, admins only.
 */
import type { Category, PrismaClient } from '@prisma/client';
import type {
  AdminRound,
  AdminStats,
  MyRound,
  PromotionPreview,
  PromotionResult,
  StudentProfile,
} from '@sirat/shared';
import type Redis from 'ioredis';
import { REDIS_CACHE } from '../src/redis/redis.module';
import { bootCoreApp, call, sessionFor, type CoreApp } from './core-helpers';
import { makeAttempt, makePublishedExam } from './exam-helpers';
import { makeUser, testPrisma } from './helpers';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let env: CoreApp;
let prisma: PrismaClient;
let redis: Redis;
let admin: { id: string; cookie: string };
let round1: { id: string };

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  redis = env.app.get(REDIS_CACHE);
  admin = await sessionFor(env, prisma, { role: 'admin' });
  round1 = await prisma.round.findUniqueOrThrow({ where: { sortOrder: 1 }, select: { id: true } });
  await cleanRounds();
});

beforeEach(() => cleanRounds());

afterAll(async () => {
  if (prisma && round1) await cleanRounds();
  await env?.app.close();
  await prisma?.$disconnect();
});

/**
 * Rounds are global data: every test starts with Round 1 alone. Only this file links exams to Round 1 (exam's test
 * helpers leave `round_id` null), so archiving them retires this file's earlier sources.
 */
async function cleanRounds() {
  await prisma.$executeRaw`
    UPDATE "exams" SET "status" = 'archived'
    WHERE "round_id" = ${round1.id}::uuid AND "status"::text = 'published'`;
  await prisma.$executeRaw`
    DELETE FROM "jury_scores" WHERE "entry_id" IN (
      SELECT e."id" FROM "round_entries" e JOIN "rounds" r ON r."id" = e."round_id" WHERE r."sort_order" > 1)`;
  await prisma.$executeRaw`
    DELETE FROM "round_entries"
    WHERE "round_id" IN (SELECT "id" FROM "rounds" WHERE "sort_order" > 1)
       OR "status"::text IN ('promoted', 'eliminated')`;
  await prisma.$executeRaw`DELETE FROM "promotion_runs"`;
  await prisma.$executeRaw`DELETE FROM "rounds" WHERE "sort_order" > 1`;
}

const details = (json: unknown) => (json as { details?: string[] }).details;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const createRound = (body: Record<string, unknown>) =>
  call<AdminRound>(env, 'POST', '/admin/rounds', admin.cookie, body);
const videoRound = (extra: Record<string, unknown> = {}) =>
  createRound({
    name: 'Video round',
    type: 'video',
    opensAt: iso(DAY_MS),
    closesAt: iso(3 * DAY_MS),
    ...extra,
  });
const patchRound = (id: string, body: Record<string, unknown>) =>
  call<AdminRound>(env, 'PATCH', `/admin/rounds/${id}`, admin.cookie, body);
const preview = (roundId: string, topN: number, category: Category) =>
  call<PromotionPreview>(env, 'POST', `/admin/rounds/${roundId}/promotion/preview`, admin.cookie, {
    topN,
    category,
  });
const promote = (roundId: string, topN: number, category: Category, expected: unknown) =>
  call<PromotionResult>(env, 'POST', `/admin/rounds/${roundId}/promotion`, admin.cookie, {
    topN,
    category,
    expected,
  });

/** A Round 1 exam whose window closed an hour ago, with a published snapshot of these rows (exam's order). */
async function publishedRound1Exam(
  rows: Array<{ category: Category; score: number; time: number }>,
  examCategory: Category | null = null,
) {
  const exam = await makePublishedExam(prisma, {
    roundId: round1.id,
    category: examCategory,
    windowStart: new Date(Date.now() - 3 * HOUR_MS),
    windowEnd: new Date(Date.now() - HOUR_MS),
    graceSeconds: 0,
    questionsPerAttempt: 10,
  });
  const sessions: Array<{ id: string; cookie: string }> = [];
  const entries = [];
  for (const row of rows) {
    const user = await sessionFor(env, prisma, { role: 'student', category: row.category });
    sessions.push(user);
    const startedAt = new Date(Date.now() - 2 * HOUR_MS);
    const attempt = await makeAttempt(prisma, user.id, exam.id, {
      startedAt,
      endsAt: new Date(startedAt.getTime() + 30 * 60_000),
      questionCount: 10,
    });
    await prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: 'submitted', submittedAt: new Date(), timeTakenSeconds: row.time },
    });
    await prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: 'scored', score: row.score },
    });
    entries.push({ userId: user.id, attemptId: attempt.id, ...row });
  }
  const ordered = [...entries].sort((a, b) => b.score - a.score || a.time - b.time);
  await prisma.leaderboardEntry.createMany({
    data: ordered.map((e, i) => ({
      examId: exam.id,
      generation: 1,
      position: i + 1,
      rank: 1 + ordered.findIndex((o) => o.score === e.score && o.time === e.time),
      userId: e.userId,
      attemptId: e.attemptId,
      name: 'Student',
      category: e.category,
      score: e.score,
      timeTakenSeconds: e.time,
    })),
  });
  const now = new Date();
  await prisma.exam.update({
    where: { id: exam.id },
    data: { resultsGeneration: 1, resultsSnapshotAt: now, resultsPublishedAt: now },
  });
  return { exam, users: sessions.map((u) => u.id), sessions };
}

describe('rounds as data', () => {
  it('adds a video round with the default criteria and a final round after Round 1, then no more', async () => {
    const video = await videoRound();
    expect(video.status).toBe(201);
    expect(video.json).toMatchObject({
      sortOrder: 2,
      type: 'video',
      scored: false,
      promotions: [],
    });
    expect(video.json.criteria).toHaveLength(10);
    expect(video.json.criteria![0]).toEqual({
      key: 'content_relevance',
      en: 'Content Relevance',
      bn: 'বিষয়বস্তুর প্রাসঙ্গিকতা',
    });

    const final = await createRound({ name: 'Final', type: 'final' });
    expect(final.status).toBe(201);
    expect(final.json).toMatchObject({
      sortOrder: 3,
      type: 'final',
      criteria: null,
      opensAt: null,
    });

    const after = await videoRound();
    expect(after.status).toBe(409);
    expect(details(after.json)).toEqual(['after_final']);

    const list = await call<{ items: AdminRound[] }>(env, 'GET', '/admin/rounds', admin.cookie);
    expect(list.json.items.map((r) => [r.sortOrder, r.type])).toEqual([
      [1, 'quiz'],
      [2, 'video'],
      [3, 'final'],
    ]);
    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'round', entityId: { in: [video.json.id, final.json.id] } },
      select: { action: true, meta: true },
    });
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.action === 'round.created')).toBe(true);
  });

  it('refuses a missing, reversed or past window, and criteria that are not unique or not for a video round', async () => {
    const window = { opensAt: iso(DAY_MS), closesAt: iso(2 * DAY_MS) };
    const cases: Array<[Record<string, unknown>, string | null]> = [
      [{ name: 'V', type: 'video', ...window }, null], // too short for the DTO
      [{ name: 'Quiz', type: 'quiz' }, null], // Round 1 is the only quiz round
      [
        {
          name: 'Video',
          type: 'video',
          ...window,
          criteria: [{ key: 'Bad Key', en: 'A', bn: 'ক' }],
        },
        null,
      ],
      [{ name: 'Video', type: 'video' }, 'bad_window'],
      [{ name: 'Video', type: 'video', opensAt: iso(DAY_MS) }, 'bad_window'],
      [
        { name: 'Video', type: 'video', opensAt: iso(2 * DAY_MS), closesAt: iso(DAY_MS) },
        'bad_window',
      ],
      [
        { name: 'Video', type: 'video', opensAt: iso(-2 * DAY_MS), closesAt: iso(-DAY_MS) },
        'bad_window',
      ],
      [{ name: 'Final', type: 'final', opensAt: iso(DAY_MS) }, 'bad_window'],
      [
        { name: 'Final', type: 'final', criteria: [{ key: 'one', en: 'One', bn: 'এক' }] },
        'bad_criteria',
      ],
      [
        {
          name: 'Video',
          type: 'video',
          ...window,
          criteria: [
            { key: 'same', en: 'A', bn: 'ক' },
            { key: 'same', en: 'B', bn: 'খ' },
          ],
        },
        'bad_criteria',
      ],
    ];
    for (const [body, code] of cases) {
      const res = await createRound(body);
      expect(res.status).toBe(400);
      if (code) expect(details(res.json)).toEqual([code]);
    }
    expect(await prisma.round.count({ where: { sortOrder: { gt: 1 } } })).toBe(0);
  });

  it('keeps an opened window from moving its start or shortening, a closed one closed, and Round 1 to its name', async () => {
    const created = await videoRound({ opensAt: iso(-HOUR_MS), closesAt: iso(DAY_MS) });
    const round = created.json;
    const moved = await patchRound(round.id, {
      opensAt: iso(HOUR_MS),
      expectedUpdatedAt: round.updatedAt,
    });
    expect(details(moved.json)).toEqual(['window_started']);
    const shorter = await patchRound(round.id, {
      closesAt: iso(HOUR_MS),
      expectedUpdatedAt: round.updatedAt,
    });
    expect(details(shorter.json)).toEqual(['window_shortened']);
    const longer = await patchRound(round.id, {
      closesAt: iso(2 * DAY_MS),
      expectedUpdatedAt: round.updatedAt,
    });
    expect(longer.status).toBe(200);
    const stale = await patchRound(round.id, {
      name: 'Renamed',
      expectedUpdatedAt: round.updatedAt,
    });
    expect(details(stale.json)).toEqual(['stale']);
    const same = await patchRound(round.id, {
      name: 'Video round',
      expectedUpdatedAt: longer.json.updatedAt,
    });
    expect(details(same.json)).toEqual(['nothing_to_update']);

    await prisma.round.update({
      where: { id: round.id },
      data: { closesAt: new Date(Date.now() - 1000), opensAt: new Date(Date.now() - DAY_MS) },
    });
    const fresh = await call<AdminRound>(env, 'GET', `/admin/rounds/${round.id}`, admin.cookie);
    const reopen = await patchRound(round.id, {
      closesAt: iso(DAY_MS),
      expectedUpdatedAt: fresh.json.updatedAt,
    });
    expect(details(reopen.json)).toEqual(['window_closed']);

    const r1 = await call<AdminRound>(env, 'GET', `/admin/rounds/${round1.id}`, admin.cookie);
    const quizWindow = await patchRound(round1.id, {
      opensAt: iso(DAY_MS),
      closesAt: iso(2 * DAY_MS),
      expectedUpdatedAt: r1.json.updatedAt,
    });
    expect(details(quizWindow.json)).toEqual(['quiz_round']);
  });

  it('freezes the criteria once the round has a jury score', async () => {
    const round = (await videoRound()).json;
    const criteria = [{ key: 'one', en: 'One', bn: 'এক' }];
    const changed = await patchRound(round.id, { criteria, expectedUpdatedAt: round.updatedAt });
    expect(changed.status).toBe(200);
    expect(changed.json.criteria).toEqual(criteria);

    const student = await makeUser(prisma, { category: 'activist' });
    const judge = await makeUser(prisma, { role: 'jury' });
    const entry = await prisma.roundEntry.create({
      data: { userId: student.id, roundId: round.id },
    });
    await prisma.juryScore.create({
      data: { entryId: entry.id, judgeId: judge.id, criteria: { one: 5 }, total: 5 },
    });
    const frozen = await patchRound(round.id, {
      criteria: [{ key: 'two', en: 'Two', bn: 'দুই' }],
      expectedUpdatedAt: changed.json.updatedAt,
    });
    expect(details(frozen.json)).toEqual(['criteria_frozen']);
    const detail = await call<AdminRound>(env, 'GET', `/admin/rounds/${round.id}`, admin.cookie);
    expect(detail.json.scored).toBe(true);
  });
});

describe('promotion from Round 1', () => {
  it('ranks inside the category, takes ties at the cut, writes once and never overwrites', async () => {
    const round2 = (await videoRound()).json;
    // An all-category exam: the achiever's global rank 1 must not count for activists.
    const { exam, users } = await publishedRound1Exam([
      { category: 'activist', score: 10, time: 100 },
      { category: 'achiever', score: 10, time: 90 },
      { category: 'activist', score: 9, time: 200 },
      { category: 'activist', score: 9, time: 200 },
      { category: 'activist', score: 8, time: 150 },
      { category: 'activist', score: 7, time: 100 },
    ]);
    const [x1, y1, x2, x3, x4, x5] = users;
    // A Round 2 entry that already has a video: promotion must leave it as it is.
    await prisma.roundEntry.create({
      data: {
        userId: x1!,
        roundId: round2.id,
        status: 'submitted',
        videoUrl: 'https://youtu.be/abc',
        videoSubmittedAt: new Date(),
      },
    });

    const p = await preview(round1.id, 2, 'activist');
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({
      from: { id: round1.id, type: 'quiz' },
      to: { id: round2.id, type: 'video' },
      source: { kind: 'exam', examId: exam.id, generation: 1 },
      candidates: 5,
      promoted: 3,
      tieCount: 1,
      eliminated: 2,
      cut: { rank: 2, score: 9, timeTakenSeconds: 200 },
      expected: { promoted: 3, sourceKey: `exam:${exam.id}:1` },
    });

    const stale = await promote(round1.id, 2, 'activist', {
      promoted: 2,
      sourceKey: p.json.expected.sourceKey,
    });
    expect([stale.status, details(stale.json)]).toEqual([409, ['stale']]);

    const run = await promote(round1.id, 2, 'activist', p.json.expected);
    expect(run.status).toBe(201);
    expect(run.json).toMatchObject({ promoted: 3, eliminated: 2, toRound: { id: round2.id } });

    const next = await prisma.roundEntry.findMany({
      where: { roundId: round2.id },
      select: { userId: true, status: true, videoUrl: true, promotionRunId: true },
    });
    expect(next.map((e) => e.userId).sort()).toEqual([x1, x2, x3].sort());
    expect(next.find((e) => e.userId === x1)).toMatchObject({
      status: 'submitted',
      videoUrl: 'https://youtu.be/abc',
      promotionRunId: null,
    });
    expect(
      next.filter((e) => e.userId !== x1).every((e) => e.promotionRunId === run.json.runId),
    ).toBe(true);
    const first = await prisma.roundEntry.findMany({
      where: { roundId: round1.id, userId: { in: users } },
      select: { userId: true, status: true },
    });
    expect(Object.fromEntries(first.map((e) => [e.userId, e.status]))).toEqual({
      [x1!]: 'promoted',
      [x2!]: 'promoted',
      [x3!]: 'promoted',
      [x4!]: 'eliminated',
      [x5!]: 'eliminated',
    });
    expect(first.some((e) => e.userId === y1)).toBe(false);

    const again = await preview(round1.id, 2, 'activist');
    expect(details(again.json)).toEqual(['already_promoted']);
    const twice = await promote(round1.id, 2, 'activist', p.json.expected);
    expect(details(twice.json)).toEqual(['already_promoted']);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'round.promoted', entityId: round1.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.meta).toMatchObject({
      category: 'activist',
      topN: 2,
      promoted: 3,
      eliminated: 2,
      source: 'exam',
    });
    for (const id of users) expect(JSON.stringify(audit.meta)).not.toContain(id);

    const listed = await call<AdminRound>(env, 'GET', `/admin/rounds/${round1.id}`, admin.cookie);
    expect(listed.json.promotions).toEqual([
      expect.objectContaining({
        category: 'activist',
        topN: 2,
        promoted: 3,
        eliminated: 2,
        toRoundId: round2.id,
      }),
    ]);
    expect(listed.json.entries).toMatchObject({ promoted: 3, eliminated: 2 });
  });

  it("shows each student their own round and the admin stats Round 2's size", async () => {
    const round2 = (await videoRound()).json;
    const { sessions } = await publishedRound1Exam(
      [
        { category: 'activist', score: 9, time: 100 },
        { category: 'activist', score: 5, time: 100 },
      ],
      'activist',
    );
    const p = await preview(round1.id, 1, 'activist');
    expect((await promote(round1.id, 1, 'activist', p.json.expected)).status).toBe(201);

    const mineTop = await call<MyRound>(env, 'GET', '/rounds/me', sessions[0]!.cookie);
    expect(mineTop.json).toMatchObject({
      round: { id: round2.id, type: 'video' },
      entryStatus: 'pending',
      videoUrl: null,
    });
    const mineOut = await call<MyRound>(env, 'GET', '/rounds/me', sessions[1]!.cookie);
    expect(mineOut.json).toMatchObject({ round: { id: round1.id }, entryStatus: 'eliminated' });
    const newcomer = await sessionFor(env, prisma, { role: 'student' });
    const mineNone = await call<MyRound>(env, 'GET', '/rounds/me', newcomer.cookie);
    expect(mineNone.json).toMatchObject({
      round: { id: round1.id, sortOrder: 1 },
      entryStatus: null,
    });
    const profile = await call<StudentProfile>(env, 'GET', '/users/me', sessions[0]!.cookie);
    expect(profile.json.currentRound).toEqual({ id: round2.id, name: 'Video round' });

    await redis.del('admin-stats:v1');
    const stats = await call<AdminStats>(env, 'GET', '/admin/stats', admin.cookie);
    expect(stats.json.totals).toMatchObject({ secondRound: 1, finalists: null });
  });

  it('refuses without a next round, without a published exam, with two sources, or with bad input', async () => {
    await publishedRound1Exam([{ category: 'activist', score: 5, time: 100 }], 'activist');
    expect(details((await preview(round1.id, 5, 'activist')).json)).toEqual(['no_next_round']);
    await videoRound();
    expect(details((await preview(round1.id, 5, 'achiever')).json)).toEqual(['no_exam']);
    await publishedRound1Exam([{ category: 'activist', score: 6, time: 100 }], null);
    expect(details((await preview(round1.id, 5, 'activist')).json)).toEqual(['ambiguous_source']);

    await cleanRounds();
    await videoRound();
    const unpublished = await makePublishedExam(prisma, {
      roundId: round1.id,
      category: 'achiever',
      windowStart: new Date(Date.now() - 3 * HOUR_MS),
      windowEnd: new Date(Date.now() - HOUR_MS),
    });
    expect(unpublished.resultsPublishedAt).toBeNull();
    expect(details((await preview(round1.id, 5, 'achiever')).json)).toEqual([
      'results_not_published',
    ]);

    for (const body of [
      { topN: 0, category: 'activist' },
      { topN: 25_001, category: 'activist' },
      { topN: 5, category: 'nobody' },
      { topN: '5', category: 'activist' },
    ]) {
      const res = await call(
        env,
        'POST',
        `/admin/rounds/${round1.id}/promotion/preview`,
        admin.cookie,
        body,
      );
      expect(res.status).toBe(400);
    }
  });

  it('lets one of two simultaneous runs through', async () => {
    await videoRound();
    await publishedRound1Exam(
      [
        { category: 'achiever', score: 9, time: 100 },
        { category: 'achiever', score: 8, time: 100 },
      ],
      'achiever',
    );
    const p = await preview(round1.id, 1, 'achiever');
    const results = await Promise.all([
      promote(round1.id, 1, 'achiever', p.json.expected),
      promote(round1.id, 1, 'achiever', p.json.expected),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.promotionRun.count()).toBe(1);
  });
});

describe('promotion from a video round', () => {
  async function videoEntries(roundId: string) {
    const make = async (status: 'pending' | 'submitted' | 'evaluated', score: number | null) => {
      const user = await makeUser(prisma, { category: 'activist' });
      const video =
        status === 'pending'
          ? {}
          : { videoUrl: 'https://youtu.be/x', videoSubmittedAt: new Date() };
      const entry = await prisma.roundEntry.create({
        data: { userId: user.id, roundId, status, score, ...video },
      });
      return entry;
    };
    return {
      e1: await make('evaluated', 80),
      e2: await make('evaluated', 70),
      e3: await make('evaluated', 70),
      e4: await make('pending', null),
      e5: await make('submitted', null),
    };
  }

  it('waits for the close and every score, then ranks by the jury average and keeps videos and scores', async () => {
    const round2 = (await videoRound()).json;
    const final = (await createRound({ name: 'Final', type: 'final' })).json;
    const { e1, e2, e3, e4, e5 } = await videoEntries(round2.id);

    expect(details((await preview(round2.id, 2, 'activist')).json)).toEqual(['window_not_closed']);
    await prisma.round.update({
      where: { id: round2.id },
      data: { opensAt: new Date(Date.now() - 2 * DAY_MS), closesAt: new Date(Date.now() - 1000) },
    });
    expect(details((await preview(round2.id, 2, 'activist')).json)).toEqual(['unscored_entries']);
    await prisma.roundEntry.update({
      where: { id: e5.id },
      data: { status: 'evaluated', score: 60 },
    });

    const p = await preview(round2.id, 2, 'activist');
    expect(p.json).toMatchObject({
      to: { id: final.id, type: 'final' },
      source: { kind: 'jury' },
      candidates: 5,
      promoted: 3,
      tieCount: 1,
      eliminated: 2,
      cut: { rank: 2, score: 70, timeTakenSeconds: null },
    });
    // A score changed after the preview: the run is refused.
    await prisma.roundEntry.update({ where: { id: e5.id }, data: { score: 61 } });
    expect(details((await promote(round2.id, 2, 'activist', p.json.expected)).json)).toEqual([
      'stale',
    ]);
    const fresh = await preview(round2.id, 2, 'activist');
    const run = await promote(round2.id, 2, 'activist', fresh.json.expected);
    expect(run.status).toBe(201);

    const after = await prisma.roundEntry.findMany({
      where: { id: { in: [e1.id, e2.id, e3.id, e4.id, e5.id] } },
      select: { id: true, status: true, score: true, videoUrl: true },
    });
    const byId = Object.fromEntries(after.map((e) => [e.id, e]));
    expect([e1, e2, e3].map((e) => byId[e.id]!.status)).toEqual([
      'promoted',
      'promoted',
      'promoted',
    ]);
    expect([e4, e5].map((e) => byId[e.id]!.status)).toEqual(['eliminated', 'eliminated']);
    expect(Number(byId[e1.id]!.score)).toBe(80);
    expect(byId[e1.id]!.videoUrl).toBe('https://youtu.be/x');
    expect(await prisma.roundEntry.count({ where: { roundId: final.id } })).toBe(3);
    expect(details((await preview(final.id, 1, 'activist')).json)).toEqual(['no_next_round']);
  });
});

describe('access and the database rules', () => {
  it('is for admins only; the student route is for students and ambassadors', async () => {
    for (const role of ['manager', 'jury', 'student', 'ambassador'] as const) {
      const s = await sessionFor(env, prisma, { role });
      expect((await call(env, 'GET', '/admin/rounds', s.cookie)).status).toBe(403);
      expect(
        (
          await call(env, 'POST', `/admin/rounds/${round1.id}/promotion/preview`, s.cookie, {
            topN: 1,
            category: 'activist',
          })
        ).status,
      ).toBe(403);
    }
    expect((await call(env, 'GET', '/rounds/me', admin.cookie)).status).toBe(403);
    const blocked = await sessionFor(env, prisma, { role: 'student' });
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    expect((await call(env, 'GET', '/rounds/me', blocked.cookie)).status).toBe(403);
    // The services re-read the admin: a token from before a demotion or a block is refused too.
    const demoted = await sessionFor(env, prisma, { role: 'admin' });
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'manager' } });
    expect((await call(env, 'GET', '/admin/rounds', demoted.cookie)).status).toBe(403);
    expect(
      (
        await call(env, 'POST', `/admin/rounds/${round1.id}/promotion/preview`, demoted.cookie, {
          topN: 1,
          category: 'activist',
        })
      ).status,
    ).toBe(403);
    const blockedAdmin = await sessionFor(env, prisma, { role: 'admin' });
    await prisma.user.update({ where: { id: blockedAdmin.id }, data: { isBlocked: true } });
    expect((await call(env, 'GET', '/admin/rounds', blockedAdmin.cookie)).status).toBe(403);
  });

  it('keeps the limits in the database too', async () => {
    const refused = async (sql: Promise<unknown>, name: string) => {
      await expect(sql).rejects.toThrow(name);
    };
    await refused(
      prisma.$executeRaw`INSERT INTO "rounds" ("id", "name", "sort_order", "type") VALUES (gen_random_uuid(), 'X', 9, 'final')`,
      'rounds_name_check',
    );
    await refused(
      prisma.$executeRaw`INSERT INTO "rounds" ("id", "name", "sort_order", "type") VALUES (gen_random_uuid(), 'Eleven', 11, 'final')`,
      'rounds_sort_order_check',
    );
    await refused(
      prisma.$executeRaw`INSERT INTO "rounds" ("id", "name", "sort_order", "type") VALUES (gen_random_uuid(), 'Video', 9, 'video')`,
      'rounds_video_check',
    );
    await refused(
      prisma.$executeRaw`INSERT INTO "rounds" ("id", "name", "sort_order", "type", "opens_at", "closes_at") VALUES (gen_random_uuid(), 'Final', 9, 'final', now(), now() - interval '1 day')`,
      'rounds_window_check',
    );
    await refused(
      prisma.$executeRaw`INSERT INTO "rounds" ("id", "name", "sort_order", "type", "criteria") VALUES (gen_random_uuid(), 'Final', 9, 'final', '[]'::jsonb)`,
      'rounds_criteria_check',
    );
    const user = await makeUser(prisma, { category: 'activist' });
    await refused(
      prisma.$executeRaw`INSERT INTO "round_entries" ("id", "user_id", "round_id", "score") VALUES (gen_random_uuid(), ${user.id}::uuid, ${round1.id}::uuid, 101)`,
      'round_entries_score_check',
    );
    await refused(
      prisma.$executeRaw`INSERT INTO "round_entries" ("id", "user_id", "round_id", "video_url") VALUES (gen_random_uuid(), ${user.id}::uuid, ${round1.id}::uuid, 'https://youtu.be/x')`,
      'round_entries_video_check',
    );
    await refused(
      prisma.$executeRaw`INSERT INTO "promotion_runs" ("id", "from_round_id", "to_round_id", "category", "top_n", "source_kind", "promoted_count", "eliminated_count", "created_by_id") VALUES (gen_random_uuid(), ${round1.id}::uuid, ${round1.id}::uuid, 'activist', 5, 'jury', 0, 0, ${admin.id}::uuid)`,
      'promotion_runs_rounds_check',
    );
  });
});
