/**
 * Scoring, the server-side finalize, the results snapshot and its publication (EXAM-PLAN 3.9, 3.10, 3.12; owner Q3,
 * Q4, Q5). The worker's jobs run here through ExamJobs directly, with no extra margins, against the real AppModule.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { PrismaClient } from '@prisma/client';
import type {
  AdminAttemptDetail,
  AdminAttemptRow,
  AdminExamLeaderboard,
  ApiError,
  AttemptView,
  ExamLeaderboard,
  ExamResultsStatus,
  Paginated,
  ReviewView,
} from '@sirat/shared';
import { AttemptStore } from '../src/modules/attempts/attempt-store';
import { ExamJobs } from '../src/modules/attempts/exam-jobs';
import { makeAttempt, makePublishedExam } from './exam-helpers';
import { makeUser, testPrisma } from './helpers';
import {
  bootEngineApp,
  call,
  type EngineApp,
  HOUR_MS,
  loginAs,
  seedExam,
  type SeededQuestion,
} from './exam-engine-app';

// Heavy or timing-sensitive on a shared machine (many starts, short real waits): a generous limit, not the 30 s default.
jest.setTimeout(180_000);

let env: EngineApp;
let prisma: PrismaClient;
let jobs: ExamJobs;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootEngineApp(0);
  prisma = testPrisma();
  jobs = new ExamJobs(env.appPrisma, env.app.get(AttemptStore), {
    finalizeAfterMs: 0,
    buildAfterMs: 0,
    rescoreAfterMs: 0,
  });
  admin = await loginAs(env, prisma, { role: 'admin' }, { registered: false });
}, 60_000);

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

/** The displayed positions of the correct options in this attempt, from the texts the student saw. */
function correctPositions(view: AttemptView, questions: SeededQuestion[]): number[] {
  return view.questions.map((shown) => {
    const q = questions.find((x) => x.text === shown.text)!;
    return shown.options.indexOf(q.options.find((o) => o.key === q.correctKey)!.text);
  });
}
const wrong = (p: number) => (p + 1) % 4;

describe('who reaches the results routes', () => {
  // GET /leaderboard has no @Roles: the deny-by-default AuthGuard makes it "any signed-in user", never public (it is
  // not @Public(), so app-routes.int-spec.ts would fail if it were opened without being on the reviewed allow-list).
  it('refuses every results route without a session (401)', async () => {
    const someId = '00000000-0000-7000-8000-000000000000';
    for (const path of [
      '/leaderboard',
      `/leaderboard?exam=${someId}`,
      '/admin/leaderboard',
      `/attempts/${someId}/review`,
      `/admin/exams/${someId}/results`,
      `/admin/exams/${someId}/attempts`,
    ])
      expect({ path, status: (await call(env, 'GET', path, '')).status }).toEqual({
        path,
        status: 401,
      });
  });

  it('lets any signed-in role read the student leaderboard', async () => {
    for (const role of ['student', 'jury', 'manager'] as const) {
      const { cookie } = await loginAs(env, prisma, { role }, { registered: false });
      expect((await call(env, 'GET', '/leaderboard', cookie)).status).toBe(200);
    }
  });
});

describe('one exam from start to published results', () => {
  it('scores, finalizes, builds, publishes, and shows only what students may see', async () => {
    const { exam, questions } = await seedExam(env, prisma, {
      count: 3,
      data: { windowEnd: new Date(Date.now() + 5_000), graceSeconds: 0 },
    });
    const student = async (name: string) => {
      const s = await loginAs(env, prisma, { name, institution: `${name} School` });
      const view = (await call<AttemptView>(env, 'POST', `/exams/${exam.id}/attempts`, s.cookie))
        .json;
      return { ...s, view, right: correctPositions(view, questions) };
    };
    const submitAnswers = (
      s: { cookie: string; view: AttemptView },
      answers: Array<number | null>,
    ) =>
      call(env, 'POST', `/attempts/${s.view.attemptId}/submit`, s.cookie, {
        requestId: randomUUID(),
        answers,
        endReason: 'submitted',
        violationCount: 0,
        events: [],
      });

    const ana = await student('Ana'); // all right, submits at once
    const bo = await student('Bo'); // one right
    const cy = await student('Cy'); // two right in a checkpoint, never submits
    const di = await student('Di'); // nothing at all
    const ed = await student('Ed'); // all right, then blocked
    expect((await submitAnswers(ana, ana.right)).status).toBe(200);
    expect((await submitAnswers(bo, [bo.right[0]!, wrong(bo.right[1]!), null])).status).toBe(200);
    expect((await submitAnswers(ed, ed.right)).status).toBe(200);
    await call(env, 'PUT', `/attempts/${cy.view.attemptId}/checkpoint`, cy.cookie, {
      seq: 1,
      answers: [cy.right[0]!, cy.right[1]!, wrong(cy.right[2]!)],
      violationCount: 2,
      events: [
        { type: 'leave', at: 5 },
        { type: 'leave', at: 9 },
      ],
    });
    await prisma.user.update({ where: { id: ed.id }, data: { isBlocked: true } });

    // Scoring right after a submit: once, idempotent.
    expect(await jobs.score(ana.view.attemptId)).toBe(true);
    expect(await jobs.score(ana.view.attemptId)).toBe(false);
    expect(
      await prisma.attempt.findUniqueOrThrow({ where: { id: ana.view.attemptId } }),
    ).toMatchObject({
      status: 'scored',
      score: 3,
    });

    // While the window is open: nothing to build or publish; students see nothing.
    let status = (
      await call<ExamResultsStatus>(env, 'GET', `/admin/exams/${exam.id}/results`, admin.cookie)
    ).json;
    expect(status).toMatchObject({ windowClosed: false, canBuild: false, canPublish: false });
    expect(
      await call<ApiError>(env, 'POST', `/admin/exams/${exam.id}/results/build`, admin.cookie),
    ).toMatchObject({
      status: 409,
      json: { details: ['window_open'] },
    });
    expect(
      await call<ApiError>(env, 'GET', `/attempts/${ana.view.attemptId}/review`, ana.cookie),
    ).toMatchObject({ status: 403, json: { details: ['results_not_published'] } });
    expect(
      (await call<ExamLeaderboard>(env, 'GET', `/leaderboard?exam=${exam.id}`, ana.cookie)).json,
    ).toMatchObject({
      status: 'unpublished',
      items: [],
    });
    const early = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(
      await call<ApiError>(env, 'POST', `/admin/exams/${exam.id}/results/publish`, admin.cookie, {
        expectedUpdatedAt: early.updatedAt.toISOString(),
      }),
    ).toMatchObject({ status: 409, json: { details: ['no_snapshot'] } });

    await sleep(5_500);
    // Two finalizes at once for the same attempt: exactly one submission.
    const both = await Promise.all([
      jobs.finalize(cy.view.attemptId),
      jobs.finalize(cy.view.attemptId),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
    // The sweep covers the whole test database (other files leave attempts behind), so only this exam is checked.
    const swept = await jobs.sweep();
    expect(swept.finalized).toBeGreaterThanOrEqual(1);
    expect(swept.built).toBeGreaterThanOrEqual(1);
    const builtOnce = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(builtOnce.resultsGeneration).toBe(1);
    await jobs.sweep(); // idempotent: nothing of this exam changes again
    expect(await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } })).toMatchObject({
      resultsGeneration: 1,
      resultsSnapshotAt: builtOnce.resultsSnapshotAt,
    });
    expect(await prisma.submission.count({ where: { attempt: { examId: exam.id } } })).toBe(5);

    const cySubmission = await prisma.submission.findUniqueOrThrow({
      where: { attemptId: cy.view.attemptId },
    });
    expect(cySubmission).toMatchObject({
      requestId: `auto.${cy.view.attemptId}`,
      endReason: 'server_checkpoint',
      answers: { v: 1, a: [cy.right[0], cy.right[1], wrong(cy.right[2]!)] },
      violationCount: 2,
    });
    expect(
      await prisma.submission.findUniqueOrThrow({ where: { attemptId: di.view.attemptId } }),
    ).toMatchObject({
      endReason: 'server_empty',
      answers: { v: 1, a: [null, null, null] },
    });
    const cyAttempt = await prisma.attempt.findUniqueOrThrow({ where: { id: cy.view.attemptId } });
    expect(cyAttempt).toMatchObject({ status: 'scored', score: 2 });
    expect(cyAttempt.timeTakenSeconds).toBe(
      Math.floor((cyAttempt.endsAt.getTime() - cyAttempt.startedAt.getTime()) / 1000),
    );

    const snapshot = await prisma.leaderboardEntry.findMany({
      where: { examId: exam.id, generation: 1 },
      orderBy: { position: 'asc' },
    });
    expect(snapshot.map((r) => [r.name, r.score, r.rank])).toEqual([
      ['Ana', 3, 1],
      ['Cy', 2, 2],
      ['Bo', 1, 3],
      ['Di', 0, 4],
    ]); // Ed is blocked: left out

    // Publish: stale copy refused, then published and audited.
    status = (
      await call<ExamResultsStatus>(env, 'GET', `/admin/exams/${exam.id}/results`, admin.cookie)
    ).json;
    expect(status).toMatchObject({ windowClosed: true, canPublish: true, generation: 1 });
    const stale = new Date(Date.now() - HOUR_MS).toISOString();
    expect(
      await call<ApiError>(env, 'POST', `/admin/exams/${exam.id}/results/publish`, admin.cookie, {
        expectedUpdatedAt: stale,
      }),
    ).toMatchObject({ status: 409, json: { details: ['stale'] } });
    const current = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    const published = await call<ExamResultsStatus>(
      env,
      'POST',
      `/admin/exams/${exam.id}/results/publish`,
      admin.cookie,
      {
        expectedUpdatedAt: current.updatedAt.toISOString(),
      },
    );
    expect(published.status).toBe(200);
    expect(published.json.publishedAt).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { entityId: exam.id, action: 'results.published', actorId: admin.id },
      }),
    ).toBe(1);

    // Students: rank, name, institution; nothing else (owner Q5).
    const board = await call<ExamLeaderboard>(
      env,
      'GET',
      `/leaderboard?exam=${exam.id}`,
      bo.cookie,
    );
    expect(board.json).toMatchObject({ status: 'published', total: 4 });
    expect(board.json.items[0]).toEqual({
      rank: 1,
      name: 'Ana',
      institution: 'Ana School',
      entryStatus: null,
    });
    expect(board.text).not.toMatch(/"(score|timeTaken\w*|email|userId)"\s*:/);
    const found = (
      await call<ExamLeaderboard>(env, 'GET', `/leaderboard?exam=${exam.id}&q=cy%20sch`, bo.cookie)
    ).json;
    expect(found.items.map((r) => r.name)).toEqual(['Cy']);

    // The student's own review: own score, rank, the correct options and explanations.
    const review = (
      await call<ReviewView>(env, 'GET', `/attempts/${bo.view.attemptId}/review`, bo.cookie)
    ).json;
    expect(review).toMatchObject({ score: 1, questionCount: 3, rank: 3, endReason: 'submitted' });
    expect(review.questions.map((q) => q.correct)).toEqual(bo.right);
    expect(review.questions.map((q) => q.chosen)).toEqual([bo.right[0], wrong(bo.right[1]!), null]);
    expect(
      (await call(env, 'GET', `/attempts/${ana.view.attemptId}/review`, bo.cookie)).status,
    ).toBe(404);

    // Admin and manager see scores and emails; a student does not get in.
    const manager = await loginAs(env, prisma, { role: 'manager' }, { registered: false });
    const adminBoard = await call<AdminExamLeaderboard>(
      env,
      'GET',
      `/admin/leaderboard?exam=${exam.id}`,
      manager.cookie,
    );
    expect(adminBoard.json).toMatchObject({ isPublic: true, generation: 1, total: 4 });
    expect(adminBoard.json.items[0]).toMatchObject({ name: 'Ana', score: 3, rank: 1 });
    expect(adminBoard.json.items[0]!.email).toMatch(/@test\.invalid$/);
    expect((await call(env, 'GET', `/admin/leaderboard?exam=${exam.id}`, bo.cookie)).status).toBe(
      403,
    );

    // Owner Q4: the admin sees how each exam ended and the violations.
    const byCheckpoint = await call<Paginated<AdminAttemptRow>>(
      env,
      'GET',
      `/admin/exams/${exam.id}/attempts?endReason=server_checkpoint`,
      admin.cookie,
    );
    expect(byCheckpoint.json.items.map((r) => r.name)).toEqual(['Cy']);
    const violators = (
      await call<Paginated<AdminAttemptRow>>(
        env,
        'GET',
        `/admin/exams/${exam.id}/attempts?minViolations=2`,
        admin.cookie,
      )
    ).json;
    expect(violators.items.map((r) => [r.name, r.violationCount])).toEqual([['Cy', 2]]);
    const detail = (
      await call<AdminAttemptDetail>(
        env,
        'GET',
        `/admin/exams/${exam.id}/attempts/${cy.view.attemptId}`,
        admin.cookie,
      )
    ).json;
    expect(detail.events).toEqual([
      { type: 'leave', at: 5 },
      { type: 'leave', at: 9 },
    ]);
    expect(
      (await call(env, 'GET', `/admin/exams/${exam.id}/attempts`, manager.cookie)).status,
    ).toBe(403);

    // Unpublish hides it again.
    const now = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    await call(env, 'POST', `/admin/exams/${exam.id}/results/unpublish`, admin.cookie, {
      expectedUpdatedAt: now.updatedAt.toISOString(),
    });
    expect(
      (await call<ExamLeaderboard>(env, 'GET', `/leaderboard?exam=${exam.id}`, bo.cookie)).json
        .status,
    ).toBe('unpublished');
    expect(
      (await call(env, 'GET', `/attempts/${bo.view.attemptId}/review`, bo.cookie)).status,
    ).toBe(403);
  });
});

describe('ranking (owner Q5)', () => {
  it('ranks by score, then time; equal score and time share a rank (1, 2, 2, 4)', async () => {
    const exam = await makePublishedExam(prisma, {
      windowStart: new Date(Date.now() - 3 * HOUR_MS),
      windowEnd: new Date(Date.now() - HOUR_MS),
      graceSeconds: 0,
      questionsPerAttempt: 5,
    });
    const scoredAttempt = async (name: string, score: number, time: number) => {
      const user = await makeUser(prisma, { name });
      const startedAt = new Date(Date.now() - 2 * HOUR_MS);
      const a = await makeAttempt(prisma, user.id, exam.id, {
        startedAt,
        endsAt: new Date(startedAt.getTime() + 30 * 60_000),
        questionCount: 5,
      });
      await prisma.attempt.update({
        where: { id: a.id },
        data: { status: 'submitted', submittedAt: new Date(), timeTakenSeconds: time },
      });
      await prisma.attempt.update({ where: { id: a.id }, data: { status: 'scored', score } });
    };
    await scoredAttempt('First', 5, 600);
    await scoredAttempt('Tied A', 4, 700);
    await scoredAttempt('Tied B', 4, 700);
    await scoredAttempt('Slower', 4, 701);
    expect(await jobs.buildResults(exam.id)).toBe('built');
    const rows = await prisma.leaderboardEntry.findMany({
      where: { examId: exam.id },
      orderBy: { position: 'asc' },
    });
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(rows[3]!.name).toBe('Slower');
  });

  it('does not build while an attempt is unfinished or the window is open', async () => {
    const open = await makePublishedExam(prisma);
    expect(await jobs.buildResults(open.id)).toBe('not_ready');
    const closed = await makePublishedExam(prisma, {
      windowStart: new Date(Date.now() - 3 * HOUR_MS),
      windowEnd: new Date(Date.now() - HOUR_MS),
    });
    const user = await makeUser(prisma);
    const startedAt = new Date(Date.now() - 2 * HOUR_MS);
    await makeAttempt(prisma, user.id, closed.id, {
      startedAt,
      endsAt: new Date(startedAt.getTime() + 30 * 60_000),
    });
    expect(await jobs.buildResults(closed.id)).toBe('not_ready');
  });
});
