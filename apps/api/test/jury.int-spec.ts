/**
 * Video and jury (core C6b, CORE-PLAN §7; the lead's notes): a student's own video link inside the window, https to
 * an allowed host; admins assign jury accounts per category of a video round; a judge sees only their categories,
 * blind, after the close; scores of every criterion make a total out of 100, the entry's score is the average of each
 * judge's latest total; scoring stops at the category's promotion; jury_scores is append-only.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PrismaClient, type Category, type Prisma } from '@prisma/client';
import type {
  AdminRound,
  AdminRoundJury,
  JuryAssignResult,
  JuryEntryRow,
  JuryRound,
  JuryScoreResult,
  MyRound,
  Paginated,
  PromotionPreview,
} from '@sirat/shared';
import { DEFAULT_VIDEO_CRITERIA } from '@sirat/shared';
import { bootCoreApp, call, sessionFor, type CoreApp } from './core-helpers';
import { testPrisma } from './helpers';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let env: CoreApp;
let prisma: PrismaClient;
let admin: { id: string; cookie: string };
let round1: { id: string };

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  admin = await sessionFor(env, prisma, { role: 'admin' });
  round1 = await prisma.round.findUniqueOrThrow({ where: { sortOrder: 1 }, select: { id: true } });
  await clean();
});

beforeEach(() => clean());

afterAll(async () => {
  if (prisma && round1) await clean();
  await env?.app.close();
  await prisma?.$disconnect();
});

/** Rounds are global data: every test starts with Round 1 alone (as in rounds.int-spec.ts). */
async function clean() {
  await prisma.$executeRaw`
    UPDATE "exams" SET "status" = 'archived'
    WHERE "round_id" = ${round1.id}::uuid AND "status"::text = 'published'`;
  // jury_scores and promotion_runs are append-only: TRUNCATE is their one way out, and only in a *_test database.
  await prisma.$executeRawUnsafe('TRUNCATE "jury_scores", "round_entries", "promotion_runs"');
  await prisma.$executeRaw`DELETE FROM "jury_assignments"`;
  await prisma.$executeRaw`DELETE FROM "rounds" WHERE "sort_order" > 1`;
}

const details = (json: unknown) => (json as { details?: string[] }).details;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const KEYS = DEFAULT_VIDEO_CRITERIA.map((c) => c.key);
/** All ten criteria at `value`, or the given per-key values. */
const scores = (value: number) => Object.fromEntries(KEYS.map((k) => [k, value]));

async function createRound(body: Record<string, unknown>) {
  const res = await call<AdminRound>(env, 'POST', '/admin/rounds', admin.cookie, body);
  expect(res.status).toBe(201);
  return res.json;
}
const openVideoRound = () =>
  createRound({
    name: 'Video round',
    type: 'video',
    opensAt: iso(-HOUR_MS),
    closesAt: iso(DAY_MS),
  });
const closeRound = (id: string) =>
  prisma.round.update({
    where: { id },
    data: { opensAt: new Date(Date.now() - 2 * DAY_MS), closesAt: new Date(Date.now() - 1000) },
  });

/** A student with an entry in the round, optionally with a video already sent. */
async function contestant(roundId: string, category: Category, video = true) {
  const s = await sessionFor(env, prisma, { role: 'student', category, name: 'Nusrat Jahan' });
  const entry = await prisma.roundEntry.create({
    data: {
      userId: s.id,
      roundId,
      ...(video
        ? {
            status: 'submitted',
            videoUrl: `https://youtu.be/${s.id.slice(-8)}`,
            videoSubmittedAt: new Date(),
          }
        : {}),
    },
  });
  return { ...s, entryId: entry.id };
}

const putVideo = (cookie: string, roundId: string, url: unknown) =>
  call<MyRound>(env, 'PUT', `/rounds/${roundId}/video`, cookie, { url });
const assign = (roundId: string, judgeId: string, categories: Category[]) =>
  call<JuryAssignResult>(env, 'POST', `/admin/rounds/${roundId}/jury`, admin.cookie, {
    judgeId,
    categories,
  });
const entries = (cookie: string, roundId: string, status = 'pending') =>
  call<Paginated<JuryEntryRow>>(
    env,
    'GET',
    `/jury/entries?round=${roundId}&status=${status}`,
    cookie,
  );
const score = (cookie: string, entryId: string, body: Record<string, unknown>) =>
  call<JuryScoreResult>(env, 'POST', `/jury/entries/${entryId}/scores`, cookie, body);

describe('the video link', () => {
  it('is sent inside the window, changed until the close, and shown back; the audit row keeps no link', async () => {
    const round = await openVideoRound();
    const s = await contestant(round.id, 'activist', false);
    const sent = await putVideo(s.cookie, round.id, '  https://youtu.be/first  ');
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({
      round: { id: round.id, type: 'video' },
      entryStatus: 'submitted',
      videoUrl: 'https://youtu.be/first',
    });
    const changed = await putVideo(s.cookie, round.id, 'https://drive.google.com/file/d/2/view');
    expect(changed.json.videoUrl).toBe('https://drive.google.com/file/d/2/view');
    const mine = await call<MyRound>(env, 'GET', '/rounds/me', s.cookie);
    expect(mine.json.videoUrl).toBe('https://drive.google.com/file/d/2/view');

    const audits = await prisma.auditLog.findMany({
      where: { action: 'round.video_submitted', actorId: s.id },
    });
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toMatch(/youtu|drive\.google/);

    for (const url of [
      'http://youtu.be/x',
      'https://vimeo.com/1',
      'https://youtu.be@evil.example/x',
    ]) {
      const bad = await putVideo(s.cookie, round.id, url);
      expect([bad.status, details(bad.json)]).toEqual([400, ['bad_video_url']]);
    }
    expect((await putVideo(s.cookie, round.id, 5)).status).toBe(400);
  });

  it('is refused outside the window, outside a video round, without an entry, and after scoring', async () => {
    const open = await openVideoRound();
    const later = await createRound({
      name: 'Second video',
      type: 'video',
      opensAt: iso(DAY_MS),
      closesAt: iso(2 * DAY_MS),
    });
    const final = await createRound({ name: 'Final', type: 'final' });
    const s = await contestant(open.id, 'activist', false);
    await prisma.roundEntry.createMany({
      data: [
        { userId: s.id, roundId: later.id },
        { userId: s.id, roundId: final.id },
      ],
    });
    const url = 'https://youtu.be/abc';
    expect(details((await putVideo(s.cookie, later.id, url)).json)).toEqual(['window_not_open']);
    expect(details((await putVideo(s.cookie, final.id, url)).json)).toEqual(['not_video_round']);
    const outsider = await sessionFor(env, prisma, { role: 'student' });
    expect((await putVideo(outsider.cookie, open.id, url)).status).toBe(404);
    expect((await putVideo(s.cookie, randomUUID(), url)).status).toBe(404);

    await prisma.roundEntry.update({
      where: { id: s.entryId },
      data: { status: 'evaluated', score: 50, videoUrl: url, videoSubmittedAt: new Date() },
    });
    expect(details((await putVideo(s.cookie, open.id, url)).json)).toEqual(['entry_closed']);
    await closeRound(open.id);
    expect(details((await putVideo(s.cookie, open.id, url)).json)).toEqual(['window_closed']);

    expect((await putVideo(admin.cookie, open.id, url)).status).toBe(403);
    const blocked = await contestant(later.id, 'activist', false);
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    expect((await putVideo(blocked.cookie, later.id, url)).status).toBe(403);
  });
});

describe('jury assignment', () => {
  it('assigns jury accounts per category of a video round, once each, and removes them', async () => {
    const round = await openVideoRound();
    const judge = await sessionFor(env, prisma, { role: 'jury', name: 'Judge One' });
    const view = await call<AdminRoundJury>(
      env,
      'GET',
      `/admin/rounds/${round.id}/jury`,
      admin.cookie,
    );
    expect(view.json.assignments).toEqual([]);
    expect(view.json.candidates.map((c) => c.userId)).toContain(judge.id);

    expect((await assign(round.id, judge.id, ['activist', 'achiever'])).json).toEqual({
      assigned: 2,
      alreadyAssigned: 0,
    });
    expect((await assign(round.id, judge.id, ['activist', 'ambassador'])).json).toEqual({
      assigned: 1,
      alreadyAssigned: 1,
    });
    const after = await call<AdminRoundJury>(
      env,
      'GET',
      `/admin/rounds/${round.id}/jury`,
      admin.cookie,
    );
    expect(after.json.assignments.map((a) => a.category).sort()).toEqual([
      'achiever',
      'activist',
      'ambassador',
    ]);
    const first = after.json.assignments[0]!;
    expect(
      (await call(env, 'DELETE', `/admin/rounds/${round.id}/jury/${first.id}`, admin.cookie))
        .status,
    ).toBe(204);
    expect(
      (await call(env, 'DELETE', `/admin/rounds/${round.id}/jury/${first.id}`, admin.cookie))
        .status,
    ).toBe(404);
    expect(
      await prisma.auditLog.count({
        where: { entityId: round.id, action: { in: ['jury.assigned', 'jury.unassigned'] } },
      }),
    ).toBe(3);

    const student = await sessionFor(env, prisma, { role: 'student' });
    expect(details((await assign(round.id, student.id, ['activist'])).json)).toEqual(['not_jury']);
    const blocked = await sessionFor(env, prisma, { role: 'jury' });
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    expect(details((await assign(round.id, blocked.id, ['activist'])).json)).toEqual(['not_jury']);
    expect(details((await assign(round1.id, judge.id, ['activist'])).json)).toEqual([
      'not_video_round',
    ]);
    for (const body of [
      { judgeId: judge.id, categories: [] },
      { judgeId: judge.id, categories: ['activist', 'activist'] },
      { judgeId: judge.id, categories: ['nobody'] },
      { judgeId: 'x', categories: ['activist'] },
    ])
      expect(
        (await call(env, 'POST', `/admin/rounds/${round.id}/jury`, admin.cookie, body)).status,
      ).toBe(400);
  });
});

describe('scoring', () => {
  it('shows a judge only their categories, blind and after the close, and averages the latest totals', async () => {
    const round = await openVideoRound();
    const final = await createRound({ name: 'Final', type: 'final' });
    const a = await contestant(round.id, 'activist');
    const b = await contestant(round.id, 'activist');
    const c = await contestant(round.id, 'achiever');
    const noVideo = await contestant(round.id, 'activist', false);
    const other = await contestant(round.id, 'ambassador');
    const judge1 = await sessionFor(env, prisma, { role: 'jury' });
    const judge2 = await sessionFor(env, prisma, { role: 'jury' });
    await assign(round.id, judge1.id, ['activist', 'achiever']);
    await assign(round.id, judge2.id, ['activist']);

    const before = await call<JuryRound[]>(env, 'GET', '/jury/rounds', judge1.cookie);
    expect(before.json).toEqual([
      expect.objectContaining({
        id: round.id,
        scoringOpen: false,
        categories: ['achiever', 'activist'],
      }),
    ]);
    expect(details((await entries(judge1.cookie, round.id)).json)).toEqual(['window_open']);
    expect(details((await score(judge1.cookie, a.entryId, { criteria: scores(7) })).json)).toEqual([
      'window_open',
    ]);

    await closeRound(round.id);
    const pending = await entries(judge1.cookie, round.id);
    expect(pending.status).toBe(200);
    expect(pending.json.items.map((e) => e.entryId).sort()).toEqual(
      [a.entryId, b.entryId, c.entryId].sort(),
    );
    expect(pending.json.items[0]).toMatchObject({
      code: expect.stringMatching(/^E-[0-9A-F]{8}$/),
      myScore: null,
    });
    // Blind: no name, user id or contact of the students.
    const text = JSON.stringify(pending.json);
    expect(text).not.toContain('Nusrat');
    for (const s of [a, b, c]) expect(text).not.toContain(s.id);

    const one = await score(judge1.cookie, a.entryId, {
      criteria: scores(7),
      comment: '  Clear.  ',
    });
    expect([one.status, one.json]).toEqual([
      201,
      { entryId: a.entryId, total: 70, score: 70, judges: 1 },
    ]);
    const two = await score(judge2.cookie, a.entryId, { criteria: scores(5) });
    expect(two.json).toMatchObject({ total: 50, score: 60, judges: 2 });
    const again = await score(judge1.cookie, a.entryId, { criteria: scores(9) });
    expect(again.json).toMatchObject({ total: 90, score: 70, judges: 2 });
    expect(await prisma.juryScore.count({ where: { entryId: a.entryId } })).toBe(3);
    const entryA = await prisma.roundEntry.findUniqueOrThrow({ where: { id: a.entryId } });
    expect([entryA.status, Number(entryA.score)]).toEqual(['evaluated', 70]);

    const evaluated = await entries(judge1.cookie, round.id, 'evaluated');
    expect(evaluated.json.items).toEqual([
      expect.objectContaining({
        entryId: a.entryId,
        myScore: expect.objectContaining({ total: 90, comment: null, criteria: scores(9) }),
      }),
    ]);
    const firstComment = await prisma.juryScore.findFirstOrThrow({
      where: { entryId: a.entryId, judgeId: judge1.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(firstComment.comment).toBe('Clear.');
    const audits = await prisma.auditLog.findMany({
      where: { action: 'jury.scored', entityId: round.id },
    });
    expect(audits).toHaveLength(3);
    expect(JSON.stringify(audits)).not.toContain('Clear');
    // The student sees their status, never a score or a comment.
    const mine = await call<MyRound>(env, 'GET', '/rounds/me', a.cookie);
    expect(mine.json.entryStatus).toBe('evaluated');
    expect(JSON.stringify(mine.json)).not.toMatch(/Clear|"score"/);

    for (const criteria of [
      { ...scores(5), extra: 3 },
      Object.fromEntries(KEYS.slice(1).map((k) => [k, 5])),
      { ...scores(5), [KEYS[0]!]: 11 },
      { ...scores(5), [KEYS[0]!]: 2.5 },
      { ...scores(5), [KEYS[0]!]: '5' },
      { ...scores(5), [KEYS[0]!]: -1 },
    ]) {
      const bad = await score(judge1.cookie, b.entryId, { criteria });
      expect([bad.status, details(bad.json)]).toEqual([400, ['bad_scores']]);
    }
    expect((await score(judge2.cookie, c.entryId, { criteria: scores(5) })).status).toBe(404);
    expect((await score(judge1.cookie, other.entryId, { criteria: scores(5) })).status).toBe(404);
    expect((await score(judge1.cookie, noVideo.entryId, { criteria: scores(5) })).status).toBe(404);
    expect(details((await entries(judge2.cookie, randomUUID())).json)).toBeUndefined();
    expect((await entries(judge2.cookie, randomUUID())).status).toBe(404);

    // Once activist is promoted, its entries take no more scores; the judge's other category stays open.
    await score(judge1.cookie, b.entryId, { criteria: scores(4) });
    const p = await call<PromotionPreview>(
      env,
      'POST',
      `/admin/rounds/${round.id}/promotion/preview`,
      admin.cookie,
      {
        topN: 1,
        category: 'activist',
      },
    );
    expect(p.json.to.id).toBe(final.id);
    const run = await call(env, 'POST', `/admin/rounds/${round.id}/promotion`, admin.cookie, {
      topN: 1,
      category: 'activist',
      expected: p.json.expected,
    });
    expect(run.status).toBe(201);
    expect(details((await score(judge2.cookie, a.entryId, { criteria: scores(6) })).json)).toEqual([
      'already_promoted',
    ]);
    const open = await entries(judge1.cookie, round.id);
    expect(open.json.items.map((e) => e.entryId)).toEqual([c.entryId]);
    const counts = await call<JuryRound[]>(env, 'GET', '/jury/rounds', judge1.cookie);
    expect(counts.json[0]).toMatchObject({ scoringOpen: true, pending: 1, evaluated: 2 });
  });
});

describe('the total', () => {
  it('is out of 100 for any number of criteria', async () => {
    const criteria = ['one', 'two', 'three', 'four'].map((key) => ({ key, en: key, bn: key }));
    const round = await createRound({
      name: 'Four criteria',
      type: 'video',
      opensAt: iso(-HOUR_MS),
      closesAt: iso(DAY_MS),
      criteria,
    });
    const s = await contestant(round.id, 'achiever');
    const judge = await sessionFor(env, prisma, { role: 'jury' });
    await assign(round.id, judge.id, ['achiever']);
    await closeRound(round.id);
    const res = await score(judge.cookie, s.entryId, {
      criteria: { one: 5, two: 5, three: 5, four: 6 },
    });
    // (5 + 5 + 5 + 6) × 100 / 40 = 52.5
    expect(res.json).toMatchObject({ total: 52.5, score: 52.5, judges: 1 });
    const bad = await score(judge.cookie, s.entryId, { criteria: scores(5) });
    expect(details(bad.json)).toEqual(['bad_scores']);
  });
});

describe('access and the database rules', () => {
  it('is for jury accounts only, re-read', async () => {
    for (const role of ['admin', 'manager', 'student', 'ambassador'] as const) {
      const s = await sessionFor(env, prisma, { role });
      expect((await call(env, 'GET', '/jury/rounds', s.cookie)).status).toBe(403);
    }
    const demoted = await sessionFor(env, prisma, { role: 'jury' });
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'student' } });
    expect((await call(env, 'GET', '/jury/rounds', demoted.cookie)).status).toBe(403);
    const blocked = await sessionFor(env, prisma, { role: 'jury' });
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    expect((await call(env, 'GET', '/jury/rounds', blocked.cookie)).status).toBe(403);
    const judge = await sessionFor(env, prisma, { role: 'jury' });
    const round = await openVideoRound();
    for (const [method, path] of [
      ['GET', `/admin/rounds/${round.id}/jury`],
      ['POST', `/admin/rounds/${round.id}/jury`],
    ] as const)
      expect(
        (await call(env, method, path, judge.cookie, method === 'POST' ? {} : undefined)).status,
      ).toBe(403);
  });

  it('keeps jury_scores append-only and within its limits', async () => {
    const round = await openVideoRound();
    const s = await contestant(round.id, 'activist');
    const judge = await sessionFor(env, prisma, { role: 'jury' });
    const row = await prisma.juryScore.create({
      data: { entryId: s.entryId, judgeId: judge.id, criteria: { one: 5 }, total: 50 },
    });
    await expect(
      prisma.juryScore.update({ where: { id: row.id }, data: { total: 60 } }),
    ).rejects.toThrow(/append-only: UPDATE/);
    await expect(prisma.juryScore.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only: DELETE/,
    );
    await expect(prisma.$executeRaw`DELETE FROM "jury_scores"`).rejects.toThrow(
      /append-only: DELETE/,
    );
    const limits: Array<[Partial<Prisma.JuryScoreUncheckedCreateInput>, string]> = [
      [{ total: 101 }, 'jury_scores_total_check'],
      [{ total: -1 }, 'jury_scores_total_check'],
      [{ criteria: [] }, 'jury_scores_criteria_check'],
      [{ comment: 'x'.repeat(1001) }, 'jury_scores_comment_check'],
    ];
    for (const [data, name] of limits)
      await expect(
        prisma.juryScore.create({
          data: { entryId: s.entryId, judgeId: judge.id, criteria: {}, total: 1, ...data },
        }),
      ).rejects.toThrow(name);

    // TRUNCATE passes here (a *_test database); the migration's own SQL in a scratch database whose name only
    // nearly ends in "_test" refuses it, with UPDATE and DELETE.
    const base = new URL(process.env.TEST_DATABASE_URL as string);
    const name = `sirat_scratch_${randomUUID().slice(0, 8)}xtest`;
    const scratchUrl = new URL(base.toString());
    scratchUrl.pathname = `/${name}`;
    scratchUrl.search = '';
    const adminUrl = new URL(base.toString());
    adminUrl.pathname = '/postgres';
    const owner = new PrismaClient({ datasourceUrl: adminUrl.toString() });
    let scratch: PrismaClient | undefined;
    try {
      await owner.$executeRawUnsafe(`CREATE DATABASE "${name}"`); // generated above: a safe identifier
      scratch = new PrismaClient({ datasourceUrl: scratchUrl.toString() });
      await scratch.$executeRawUnsafe(
        'CREATE TABLE "jury_scores" ("id" int, "criteria" jsonb, "total" numeric(8,2), "comment" text)',
      );
      await scratch.$executeRawUnsafe(`INSERT INTO "jury_scores" VALUES (1, '{}', 5, NULL)`);
      const migration = join(
        __dirname,
        '../prisma/migrations/20261101070001_core_jury_checks/migration.sql',
      );
      execFileSync(
        'prisma',
        ['db', 'execute', '--file', migration, '--url', scratchUrl.toString()],
        {
          stdio: 'pipe',
          shell: process.platform === 'win32',
        },
      );
      for (const [sql, op] of [
        ['TRUNCATE "jury_scores"', 'TRUNCATE'],
        ['UPDATE "jury_scores" SET "total" = 6', 'UPDATE'],
        ['DELETE FROM "jury_scores"', 'DELETE'],
      ] as const)
        await expect(scratch.$executeRawUnsafe(sql)).rejects.toThrow(`append-only: ${op}`);
    } finally {
      await scratch?.$disconnect();
      await owner.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await owner.$disconnect();
    }
  }, 120_000);
});
