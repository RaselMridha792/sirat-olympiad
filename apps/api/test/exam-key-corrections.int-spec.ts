/**
 * Answer-key corrections after publish (E7b; DECISIONS "Answer-key correction"): the question rows stay frozen, a
 * correction is an append-only row whose key is the one in effect, the scored attempts are re-scored by a job (or the
 * sweep's catch-up), and no snapshot from before a correction can be published. The worker's jobs run here through
 * ExamJobs directly, with no margins, against the real AppModule.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type {
  AdminExamView,
  AnswerKeyCorrectionView,
  ApiError,
  ExamResultsStatus,
  ReviewView,
} from '@sirat/shared';
import { AttemptStore } from '../src/modules/attempts/attempt-store';
import { ExamJobs } from '../src/modules/attempts/exam-jobs';
import { databaseNow } from '../src/modules/exams/answer-keys';
import { REDIS_QUEUE } from '../src/redis/redis.module';
import { makeAttempt, submissionData } from './exam-helpers';
import { makeUser, testPrisma } from './helpers';
import {
  bootEngineApp,
  call,
  closeEngineApp,
  type EngineApp,
  HOUR_MS,
  loginAs,
  seedExam,
} from './exam-engine-app';

jest.setTimeout(120_000);

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
    keyRescoreAfterMs: 0,
  });
  admin = await loginAs(env, prisma, { role: 'admin' }, { registered: false });
}, 60_000);

afterAll(async () => {
  await closeEngineApp(env);
  await prisma?.$disconnect();
});

/** A published exam whose window closed an hour ago; every question's key is C (displayed position 2 below). */
async function closedExam(count = 2, status: 'published' | 'draft' = 'published') {
  return seedExam(env, prisma, {
    count,
    data: {
      windowStart: new Date(Date.now() - 3 * HOUR_MS),
      windowEnd: new Date(Date.now() - HOUR_MS),
      graceSeconds: 0,
      // seedExam publishes it afterwards unless it is created a draft.
      ...(status === 'draft' ? { status } : {}),
    },
  });
}

/** A submitted attempt with the options in their stored order (displayed position i is option i: 0 A … 3 D). */
async function submittedAttempt(
  examId: string,
  questionIds: string[],
  answers: Array<number | null>,
  who: { name?: string; userId?: string } = {},
) {
  const user = who.userId
    ? { id: who.userId }
    : await makeUser(prisma, who.name ? { name: who.name } : {});
  const startedAt = new Date(Date.now() - 2 * HOUR_MS);
  const attempt = await makeAttempt(prisma, user.id, examId, {
    startedAt,
    endsAt: new Date(startedAt.getTime() + 30 * 60_000),
    layout: { v: 1, q: questionIds, o: questionIds.map(() => [0, 1, 2, 3]) },
    questionCount: questionIds.length,
  });
  await prisma.submission.create({
    data: submissionData(attempt.id, { answers: { v: 1, a: answers } }),
  });
  await prisma.attempt.update({
    where: { id: attempt.id },
    data: { status: 'submitted', submittedAt: new Date(), timeTakenSeconds: 600 },
  });
  return { id: attempt.id, userId: user.id };
}

async function scoredAttempt(...args: Parameters<typeof submittedAttempt>) {
  const attempt = await submittedAttempt(...args);
  expect(await jobs.score(attempt.id)).toBe(true);
  return attempt;
}

const updatedAt = async (examId: string) =>
  (await prisma.exam.findUniqueOrThrow({ where: { id: examId } })).updatedAt.toISOString();

const correct = async (
  examId: string,
  questionId: string,
  body: Record<string, unknown>,
  cookie = admin.cookie,
) =>
  call<AnswerKeyCorrectionView & ApiError>(
    env,
    'POST',
    `/admin/exams/${examId}/questions/${questionId}/key-corrections`,
    cookie,
    { reason: 'The printed key was wrong', expectedUpdatedAt: await updatedAt(examId), ...body },
  );

const resultsOf = async (examId: string) =>
  (await call<ExamResultsStatus>(env, 'GET', `/admin/exams/${examId}/results`, admin.cookie)).json;

const scores = async (ids: string[]) =>
  (
    await prisma.attempt.findMany({
      where: { id: { in: ids } },
      select: { id: true, score: true },
    })
  )
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    .map((a) => a.score);

/** Resolves `promise` into a flag, so a test can see it is still waiting on a lock. */
function watch<T>(promise: Promise<T>) {
  const state = { done: false };
  const settled = promise.finally(() => {
    state.done = true;
  });
  return { state, settled };
}

describe('who may correct a key, and what is refused', () => {
  it('refuses without a session (401) and for a manager (403)', async () => {
    const { exam, questions } = await closedExam(1);
    expect((await correct(exam.id, questions[0]!.id, { toKey: 'B' }, '')).status).toBe(401);
    const manager = await loginAs(env, prisma, { role: 'manager' }, { registered: false });
    expect((await correct(exam.id, questions[0]!.id, { toKey: 'B' }, manager.cookie)).status).toBe(
      403,
    );
    expect(await prisma.answerKeyCorrection.count({ where: { examId: exam.id } })).toBe(0);
  });

  it('validates the body: one capital letter, a 3-200 character reason with no control characters, no extras', async () => {
    const { exam, questions } = await closedExam(1);
    const q = questions[0]!.id;
    for (const body of [
      { toKey: 'b' },
      { toKey: 'BB' },
      { toKey: 'B', reason: 'no' },
      { toKey: 'B', reason: 'x'.repeat(201) },
      { toKey: 'B', reason: 'bad\u0000reason' },
      { toKey: 'B', reason: 'bad\u0007reason' },
      { toKey: 'B', expectedUpdatedAt: 'yesterday' },
      { toKey: 'B', fromKey: 'C' },
    ])
      expect({ body, status: (await correct(exam.id, q, body)).status }).toEqual({
        body,
        status: 400,
      });
    expect(await prisma.answerKeyCorrection.count({ where: { examId: exam.id } })).toBe(0);
  });

  it('refuses a draft, an archived exam, a stale copy, an unknown or unchanged key, and a question of another exam', async () => {
    const draft = await closedExam(1, 'draft');
    expect(await correct(draft.exam.id, draft.questions[0]!.id, { toKey: 'B' })).toMatchObject({
      status: 409,
      json: { details: ['exam_draft'] },
    });

    const { exam, questions } = await closedExam(1);
    const q = questions[0]!.id;
    expect(await correct(exam.id, q, { toKey: 'C' })).toMatchObject({
      status: 409,
      json: { details: ['same_key'] },
    });
    expect(await correct(exam.id, q, { toKey: 'E' })).toMatchObject({
      status: 409,
      json: { details: ['key_unknown'] },
    });
    expect(
      await correct(exam.id, q, {
        toKey: 'B',
        expectedUpdatedAt: new Date(Date.now() - HOUR_MS).toISOString(),
      }),
    ).toMatchObject({ status: 409, json: { details: ['stale'] } });
    expect(await correct(exam.id, draft.questions[0]!.id, { toKey: 'B' })).toMatchObject({
      status: 404,
      json: { details: ['question_not_in_exam'] },
    });

    const archived = await closedExam(1);
    await prisma.exam.update({ where: { id: archived.exam.id }, data: { status: 'archived' } });
    expect(
      await correct(archived.exam.id, archived.questions[0]!.id, { toKey: 'B' }),
    ).toMatchObject({ status: 409, json: { details: ['exam_archived'] } });
    expect(
      await prisma.answerKeyCorrection.count({
        where: { examId: { in: [draft.exam.id, exam.id, archived.exam.id] } },
      }),
    ).toBe(0);
  });
});

describe('a correction from start to published results', () => {
  it('keeps the question row, re-scores every attempt, blocks Build and Publish until done, and shows from → to and the count', async () => {
    const { exam, questions } = await closedExam(2);
    const ids = questions.map((q) => q.id);
    const anaLogin = await loginAs(env, prisma, { name: 'Ana' }, { registered: false });
    const ana = await scoredAttempt(exam.id, ids, [2, 2], { userId: anaLogin.id }); // C C: 2, then 1
    const bo = await scoredAttempt(exam.id, ids, [1, 2], { name: 'Bo' }); // B C: 1, then 2
    const cy = await scoredAttempt(exam.id, ids, [1, 1], { name: 'Cy' }); // B B: 0, then 1
    const di = await scoredAttempt(exam.id, ids, [3, 3], { name: 'Di' }); // D D: 0, still 0
    const all = [ana.id, bo.id, cy.id, di.id];
    expect(await scores(all)).toEqual([2, 1, 0, 0]);
    expect(await jobs.buildResults(exam.id)).toBe('built');
    expect(await resultsOf(exam.id)).toMatchObject({
      canPublish: true,
      keyCorrectedAt: null,
      rescorePending: 0,
      snapshotStale: false,
      lastCorrection: null,
    });
    const before = await prisma.question.findUniqueOrThrow({ where: { id: ids[0]! } });

    const res = await correct(exam.id, ids[0]!, { toKey: 'B', reason: '  Key misprinted  ' });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      questionId: ids[0],
      position: 1,
      fromKey: 'C',
      toKey: 'B',
      reason: 'Key misprinted',
    });
    expect(res.json.createdByName).toBeTruthy();
    // DON'T 8: the published question is untouched; the correction is its own row.
    expect(await prisma.question.findUniqueOrThrow({ where: { id: ids[0]! } })).toEqual(before);
    expect(
      await prisma.auditLog.findFirstOrThrow({
        where: { action: 'answer_key.corrected', entityId: exam.id, actorId: admin.id },
        select: { meta: true },
      }),
    ).toMatchObject({ meta: { correctionId: res.json.id, from: 'C', to: 'B' } });
    // The job went to this run's own queue.
    const queue = new Queue(env.examQueueName, { connection: env.app.get<Redis>(REDIS_QUEUE) });
    expect(await queue.getJob(`rescore.${exam.id}.${res.json.id}`)).toBeTruthy();
    await queue.close();
    // The admin's exam view lists it.
    const view = (await call<AdminExamView>(env, 'GET', `/admin/exams/${exam.id}`, admin.cookie))
      .json;
    expect(view.keyCorrections).toEqual([res.json]);

    // Until the re-scoring is done: nothing to build, the old snapshot cannot be published.
    let status = await resultsOf(exam.id);
    expect(status).toMatchObject({
      rescorePending: 4,
      snapshotStale: true,
      canBuild: false,
      canPublish: false,
      keyCorrectedAt: res.json.createdAt,
      lastCorrection: { position: 1, fromKey: 'C', toKey: 'B', attempts: null, changed: null },
    });
    expect(
      await call<ApiError>(env, 'POST', `/admin/exams/${exam.id}/results/build`, admin.cookie),
    ).toMatchObject({ status: 409, json: { details: ['rescore_pending'] } });
    expect(
      await call<ApiError>(env, 'POST', `/admin/exams/${exam.id}/results/publish`, admin.cookie, {
        expectedUpdatedAt: await updatedAt(exam.id),
      }),
    ).toMatchObject({ status: 409, json: { details: ['snapshot_stale'] } });
    expect(await jobs.buildResults(exam.id)).toBe('not_ready');

    // The job: every attempt re-scored with the corrected key; a second run changes nothing.
    expect(await jobs.rescoreAfterCorrection(exam.id, res.json.id)).toEqual({
      attempts: 4,
      changed: 3,
    });
    expect(await scores(all)).toEqual([1, 2, 1, 0]);
    expect(await jobs.rescoreAfterCorrection(exam.id, res.json.id)).toEqual({
      attempts: 0,
      changed: 0,
    });
    expect(await scores(all)).toEqual([1, 2, 1, 0]);
    status = await resultsOf(exam.id);
    expect(status).toMatchObject({
      rescorePending: 0,
      snapshotStale: true,
      canBuild: true,
      canPublish: false,
      lastCorrection: { attempts: 4, changed: 3 },
    });

    // A new snapshot, then Publish.
    expect(await jobs.buildResults(exam.id)).toBe('built');
    expect(await resultsOf(exam.id)).toMatchObject({ snapshotStale: false, canPublish: true });
    const board = await prisma.leaderboardEntry.findMany({
      where: { examId: exam.id, generation: 2 },
      orderBy: { position: 'asc' },
    });
    expect(board.map((r) => [r.name, r.score])).toEqual([
      ['Bo', 2],
      ['Ana', 1],
      ['Cy', 1],
      ['Di', 0],
    ]);
    const published = await call(
      env,
      'POST',
      `/admin/exams/${exam.id}/results/publish`,
      admin.cookie,
      { expectedUpdatedAt: await updatedAt(exam.id) },
    );
    expect(published.status).toBe(200);

    // The student's review marks the corrected key.
    const review = (
      await call<ReviewView>(env, 'GET', `/attempts/${ana.id}/review`, anaLogin.cookie)
    ).json;
    expect(review.score).toBe(1);
    expect(review.questions.map((q) => q.correct)).toEqual([1, 2]);

    // While published, no correction: unpublish first.
    expect(await correct(exam.id, ids[1]!, { toKey: 'A' })).toMatchObject({
      status: 409,
      json: { details: ['results_published'] },
    });
  });

  it('is caught up by the sweep when the job never ran, and counts right when two runs overlap', async () => {
    const { exam, questions } = await closedExam(1);
    const ids = [questions[0]!.id];
    const attempts = [];
    for (const a of [0, 1, 2, 3, 0, 1]) attempts.push((await scoredAttempt(exam.id, ids, [a])).id);
    expect(await scores(attempts)).toEqual([0, 0, 1, 0, 0, 0]);

    // The job is lost (no worker here): the sweep re-scores the exam.
    const first = await correct(exam.id, ids[0]!, { toKey: 'A' });
    expect(first.status).toBe(201);
    await jobs.sweep();
    expect(await scores(attempts)).toEqual([1, 0, 0, 0, 1, 0]);
    expect(await resultsOf(exam.id)).toMatchObject({
      rescorePending: 0,
      lastCorrection: { fromKey: 'C', toKey: 'A', attempts: 6, changed: 3 },
    });

    // A second correction, then the job and the catch-up at once: each attempt is taken by one run only.
    const second = await correct(exam.id, ids[0]!, { toKey: 'B' });
    expect(second.json).toMatchObject({ fromKey: 'A', toKey: 'B' });
    const runs = await Promise.all([jobs.rescore(exam.id), jobs.rescore(exam.id)]);
    expect(runs.reduce((n, r) => n + r.attempts, 0)).toBe(6);
    expect(runs.reduce((n, r) => n + r.changed, 0)).toBe(4);
    expect(await scores(attempts)).toEqual([0, 1, 0, 0, 0, 1]);
    expect(await resultsOf(exam.id)).toMatchObject({
      rescorePending: 0,
      lastCorrection: { fromKey: 'A', toKey: 'B', attempts: 6, changed: 4 },
    });
  });
});

describe('the exam row lock orders a correction and a scoring (FOR UPDATE against FOR SHARE)', () => {
  it('a scoring that holds the exam first is counted as waiting for its re-scoring', async () => {
    const { exam, questions } = await closedExam(1);
    const attempt = await submittedAttempt(exam.id, [questions[0]!.id], [2]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // A scoring's transaction, held open: the exam FOR SHARE, the score written with the old key at the last moment.
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "exams" WHERE "id" = ${exam.id}::uuid FOR SHARE`;
        await gate;
        await tx.attempt.update({
          where: { id: attempt.id },
          data: { status: 'scored', score: 1, scoredAt: await databaseNow(tx) },
        });
      },
      { timeout: 30_000 },
    );
    await sleep(100);
    const correction = watch(correct(exam.id, questions[0]!.id, { toKey: 'A' }));
    await sleep(700);
    expect(correction.state.done).toBe(false); // waits for the scoring's FOR SHARE
    release();
    await holder;
    const res = await correction.settled;
    expect(res.status).toBe(201);
    const scored = await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
    // created_at is the database's clock after the lock, so it is later than the score written while it waited.
    expect(new Date(res.json.createdAt).getTime()).toBeGreaterThan(scored.scoredAt!.getTime());
    expect(await resultsOf(exam.id)).toMatchObject({ rescorePending: 1 });
    await jobs.rescore(exam.id);
    expect(await scores([attempt.id])).toEqual([0]);
    expect(await resultsOf(exam.id)).toMatchObject({ rescorePending: 0 });
  });

  it('a scoring that comes during a correction waits for it and uses the corrected key', async () => {
    const { exam, questions } = await closedExam(1);
    const attempt = await submittedAttempt(exam.id, [questions[0]!.id], [0]); // A: wrong now, right after
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // A correction's transaction, held open: the exam FOR UPDATE and the new row.
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "exams" WHERE "id" = ${exam.id}::uuid FOR UPDATE`;
        await tx.answerKeyCorrection.create({
          data: {
            examId: exam.id,
            questionId: questions[0]!.id,
            fromKey: 'C',
            toKey: 'A',
            reason: 'Held open by the test',
            createdById: admin.id,
            createdAt: await databaseNow(tx),
          },
        });
        await gate;
      },
      { timeout: 30_000 },
    );
    await sleep(100);
    const scoring = watch(jobs.score(attempt.id));
    await sleep(700);
    expect(scoring.state.done).toBe(false); // waits for the correction's FOR UPDATE
    release();
    await holder;
    expect(await scoring.settled).toBe(true);
    expect(await scores([attempt.id])).toEqual([1]);
    expect(await resultsOf(exam.id)).toMatchObject({ rescorePending: 0 });
  });
});

describe('the table itself (CHECKs and triggers)', () => {
  it('refuses a bad row, any change or removal, and a correction of a draft', async () => {
    const { exam, questions } = await closedExam(2);
    const other = await closedExam(1);
    const draft = await closedExam(1, 'draft');
    const row = (data: Record<string, unknown>) => ({
      examId: exam.id,
      questionId: questions[0]!.id,
      fromKey: 'C',
      toKey: 'B',
      reason: 'A test reason',
      createdById: admin.id,
      ...data,
    });
    const insert = (data: Record<string, unknown>) =>
      prisma.answerKeyCorrection.create({ data: row(data) as never });
    // A BEFORE trigger runs before the CHECKs: a lower-case key is refused there first (no option has it).
    await expect(insert({ toKey: 'b' })).rejects.toThrow(/is not an option of question/);
    await expect(
      prisma.$executeRaw`SELECT 1 FROM pg_constraint WHERE conname = 'answer_key_corrections_keys_check'`,
    ).resolves.toBe(1);
    await expect(insert({ toKey: 'C' })).rejects.toThrow(/answer_key_corrections_changes_check/);
    await expect(insert({ reason: 'no' })).rejects.toThrow(/answer_key_corrections_reason_check/);
    await expect(insert({ toKey: 'E' })).rejects.toThrow(/is not an option of question/);
    await expect(insert({ questionId: other.questions[0]!.id })).rejects.toThrow(/is not in exam/);
    await expect(
      insert({ examId: draft.exam.id, questionId: draft.questions[0]!.id }),
    ).rejects.toThrow(/is a draft/);
    const saved = await insert({});
    await expect(
      prisma.answerKeyCorrection.update({ where: { id: saved.id }, data: { toKey: 'A' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.answerKeyCorrection.delete({ where: { id: saved.id } })).rejects.toThrow(
      /append-only/,
    );
  });
});
