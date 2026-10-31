/**
 * The exam engine's database rules (docs/plans/EXAM-PLAN.md 2.2, 2.4): CHECKs, the one-active-version index and the
 * lock triggers, proved against a real Postgres (*_test database). The API checks the same rules first; these tests
 * show the database refuses even when the API would not.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { examData, makeUser, testPrisma, truncateAll } from './helpers';
import {
  OPTIONS,
  makeAttempt,
  makePublishedExam,
  questionData,
  submissionData,
} from './exam-helpers';

const prisma: PrismaClient = testPrisma();

beforeAll(async () => {
  await truncateAll(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const UNIQUE = { code: 'P2002' };
const HOUR_MS = 60 * 60 * 1000;

describe('exams', () => {
  it('caps the grace at 300 seconds', async () => {
    await expect(prisma.exam.create({ data: examData({ graceSeconds: 301 }) })).rejects.toThrow(
      /exams_grace_seconds_max_check/,
    );
    await expect(
      prisma.exam.create({ data: examData({ graceSeconds: 300 }) }),
    ).resolves.toBeTruthy();
  });

  it('needs published_at on a published exam', async () => {
    await expect(prisma.exam.create({ data: examData({ status: 'published' }) })).rejects.toThrow(
      /exams_published_at_check/,
    );
  });

  it('refuses results before window_end + grace, and on a draft', async () => {
    const windowEnd = new Date('2026-11-02T18:00:00Z');
    const boundary = new Date(windowEnd.getTime() + 30_000);
    const exam = await makePublishedExam(prisma, {
      windowStart: new Date('2026-11-01T04:00:00Z'),
      windowEnd,
      graceSeconds: 30,
    });
    await expect(
      prisma.exam.update({
        where: { id: exam.id },
        data: { resultsPublishedAt: new Date(boundary.getTime() - 1000) },
      }),
    ).rejects.toThrow(/exams_results_after_window_check/);
    await expect(
      prisma.exam.update({ where: { id: exam.id }, data: { resultsPublishedAt: boundary } }),
    ).resolves.toBeTruthy();

    await expect(
      prisma.exam.create({
        data: examData({ windowEnd, resultsPublishedAt: new Date(boundary.getTime() + HOUR_MS) }),
      }),
    ).rejects.toThrow(/exams_results_after_window_check/);
  });
});

describe('exams_frozen_after_publish (trigger)', () => {
  it.each([
    ['durationMinutes', { durationMinutes: 20 }],
    ['questionsPerAttempt', { questionsPerAttempt: 5 }],
    ['graceSeconds', { graceSeconds: 10 }],
    ['category', { category: 'achiever' as const }],
    ['randomDraw', { randomDraw: true }],
    ['windowStart', { windowStart: new Date(Date.now() - 2 * HOUR_MS) }],
  ])('refuses a change of %s once published', async (_field, data) => {
    const exam = await makePublishedExam(prisma);
    await expect(prisma.exam.update({ where: { id: exam.id }, data })).rejects.toThrow(
      /exams_frozen_after_publish/,
    );
  });

  it('lets the title change and the window grow while it is open, never shrink', async () => {
    const exam = await makePublishedExam(prisma);
    await expect(
      prisma.exam.update({ where: { id: exam.id }, data: { title: 'Renamed' } }),
    ).resolves.toBeTruthy();
    const later = new Date(exam.windowEnd.getTime() + HOUR_MS);
    await expect(
      prisma.exam.update({ where: { id: exam.id }, data: { windowEnd: later } }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.exam.update({ where: { id: exam.id }, data: { windowEnd: exam.windowEnd } }),
    ).rejects.toThrow(/exams_frozen_after_publish/);
  });

  it('never reopens a window that has ended', async () => {
    const exam = await makePublishedExam(prisma, {
      windowStart: new Date(Date.now() - 3 * HOUR_MS),
      windowEnd: new Date(Date.now() - HOUR_MS),
    });
    await expect(
      prisma.exam.update({
        where: { id: exam.id },
        data: { windowEnd: new Date(Date.now() + HOUR_MS) },
      }),
    ).rejects.toThrow(/exams_frozen_after_publish/);
  });

  it('goes back to draft only without attempts', async () => {
    const empty = await makePublishedExam(prisma);
    await expect(
      prisma.exam.update({ where: { id: empty.id }, data: { status: 'draft' } }),
    ).resolves.toBeTruthy();

    const taken = await makePublishedExam(prisma);
    await makeAttempt(prisma, (await makeUser(prisma)).id, taken.id);
    await expect(
      prisma.exam.update({ where: { id: taken.id }, data: { status: 'draft' } }),
    ).rejects.toThrow(/exams_frozen_after_publish/);
  });

  it('refuses every change to an archived exam', async () => {
    const exam = await prisma.exam.create({ data: examData({ status: 'archived' }) });
    await expect(
      prisma.exam.update({ where: { id: exam.id }, data: { title: 'Again' } }),
    ).rejects.toThrow(/exams_frozen_after_publish/);
  });

  it('leaves drafts free', async () => {
    const exam = await prisma.exam.create({ data: examData() });
    await expect(
      prisma.exam.update({
        where: { id: exam.id },
        data: { durationMinutes: 10, graceSeconds: 0 },
      }),
    ).resolves.toBeTruthy();
  });
});

describe('questions', () => {
  // Postgres checks CHECK constraints in name order, so a non-array also fails the correct-key check first.
  it.each([
    ['one option', OPTIONS.slice(0, 1), /questions_options_check/],
    ['seven options', [...OPTIONS, ...OPTIONS.slice(0, 3)], /questions_options_check/],
    ['not an array', { key: 'A', text: 'Alpha' }, /questions_(correct_key|options)_check/],
  ])('refuses options as %s', async (_label, options, constraint) => {
    const exam = await prisma.exam.create({ data: examData() });
    await expect(
      prisma.question.create({ data: questionData(exam.id, { options, correctKey: 'A' }) }),
    ).rejects.toThrow(constraint);
  });

  it('refuses a correct key that is not one of the options', async () => {
    const exam = await prisma.exam.create({ data: examData() });
    await expect(
      prisma.question.create({ data: questionData(exam.id, { correctKey: 'E' }) }),
    ).rejects.toThrow(/questions_correct_key_check/);
  });

  it('refuses empty text and an active row with a deactivation time', async () => {
    const exam = await prisma.exam.create({ data: examData() });
    await expect(
      prisma.question.create({ data: questionData(exam.id, { text: '' }) }),
    ).rejects.toThrow(/questions_text_check/);
    await expect(
      prisma.question.create({ data: questionData(exam.id, { deactivatedAt: new Date() }) }),
    ).rejects.toThrow(/questions_active_check/);
  });

  it('keeps one active version per lineage and unique version numbers', async () => {
    const exam = await prisma.exam.create({ data: examData() });
    const first = await prisma.question.create({ data: questionData(exam.id) });
    await expect(
      prisma.question.create({
        data: questionData(exam.id, { lineageId: first.lineageId, version: 2 }),
      }),
    ).rejects.toMatchObject(UNIQUE);
    await expect(
      prisma.question.create({
        data: questionData(exam.id, {
          lineageId: first.lineageId,
          version: 1,
          isActive: false,
          deactivatedAt: new Date(),
        }),
      }),
    ).rejects.toMatchObject(UNIQUE);
  });

  it('raises the exam content version on every question write', async () => {
    const exam = await prisma.exam.create({ data: examData() });
    const q = await prisma.question.create({ data: questionData(exam.id) });
    await prisma.question.update({ where: { id: q.id }, data: { text: 'Edited' } });
    await prisma.question.delete({ where: { id: q.id } });
    const after = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(after.contentVersion).toBe(exam.contentVersion + 3);
  });
});

describe('questions_frozen_after_publish (trigger)', () => {
  async function publishedQuestion() {
    const exam = await makePublishedExam(prisma);
    const question = await prisma.question.create({ data: questionData(exam.id) });
    return { exam, question };
  }

  it.each([
    ['text', { text: 'Rewritten' }],
    ['options', { options: OPTIONS.slice(0, 3) }],
    ['correctKey', { correctKey: 'C' }],
    ['explanation', { explanation: 'Now explained' }],
    ['position', { position: 2 }],
    ['keepOptionOrder', { keepOptionOrder: true }],
  ])('refuses a change of %s in a published exam', async (_field, data) => {
    const { question } = await publishedQuestion();
    await expect(prisma.question.update({ where: { id: question.id }, data })).rejects.toThrow(
      /questions_frozen_after_publish/,
    );
  });

  it('refuses DELETE in a published exam, through Prisma and raw SQL', async () => {
    const { question } = await publishedQuestion();
    await expect(prisma.question.delete({ where: { id: question.id } })).rejects.toThrow(
      /questions_frozen_after_publish/,
    );
    await expect(
      prisma.$executeRaw`DELETE FROM questions WHERE id = ${question.id}::uuid`,
    ).rejects.toThrow(/questions_frozen_after_publish/);
  });

  it('allows deactivation and a new version, never reactivation', async () => {
    const { exam, question } = await publishedQuestion();
    await prisma.question.update({
      where: { id: question.id },
      data: { isActive: false, deactivatedAt: new Date() },
    });
    await expect(
      prisma.question.create({
        data: questionData(exam.id, { lineageId: question.lineageId, version: 2 }),
      }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.question.update({
        where: { id: question.id },
        data: { isActive: true, deactivatedAt: null },
      }),
    ).rejects.toThrow(/questions_frozen_after_publish/);
  });

  it('lets drafts edit and delete in place', async () => {
    const exam = await prisma.exam.create({ data: examData() });
    const q = await prisma.question.create({ data: questionData(exam.id) });
    await expect(
      prisma.question.update({ where: { id: q.id }, data: { text: 'Fixed typo' } }),
    ).resolves.toBeTruthy();
    await expect(prisma.question.delete({ where: { id: q.id } })).resolves.toBeTruthy();
  });

  it('refuses new questions in an archived exam', async () => {
    const exam = await prisma.exam.create({ data: examData({ status: 'archived' }) });
    await expect(prisma.question.create({ data: questionData(exam.id) })).rejects.toThrow(
      /questions_frozen_after_publish/,
    );
  });
});

describe('attempts', () => {
  it('allows one attempt per student per exam (the timer can never be reset)', async () => {
    const user = await makeUser(prisma);
    const exam = await makePublishedExam(prisma);
    await makeAttempt(prisma, user.id, exam.id);
    await expect(makeAttempt(prisma, user.id, exam.id)).rejects.toMatchObject(UNIQUE);
  });

  it('refuses an attempt for a draft exam and one that does not start in progress', async () => {
    const user = await makeUser(prisma);
    const draft = await prisma.exam.create({ data: examData() });
    await expect(makeAttempt(prisma, user.id, draft.id)).rejects.toThrow(/attempts_guard/);
    const exam = await makePublishedExam(prisma);
    await expect(
      makeAttempt(prisma, user.id, exam.id, { status: 'submitted', submittedAt: new Date() }),
    ).rejects.toThrow(/attempts_guard/);
  });

  it('refuses a duration over 30 minutes and a score above the question count', async () => {
    const exam = await makePublishedExam(prisma);
    const startedAt = new Date();
    await expect(
      makeAttempt(prisma, (await makeUser(prisma)).id, exam.id, {
        startedAt,
        endsAt: new Date(startedAt.getTime() + 30 * 60_000 + 1000),
      }),
    ).rejects.toThrow(/attempts_ends_at_check/);

    const a = await makeAttempt(prisma, (await makeUser(prisma)).id, exam.id, { questionCount: 3 });
    await prisma.attempt.update({
      where: { id: a.id },
      data: { status: 'submitted', submittedAt: new Date() },
    });
    await expect(
      prisma.attempt.update({ where: { id: a.id }, data: { status: 'scored', score: 4 } }),
    ).rejects.toThrow(/attempts_score_check/);
  });

  it.each([
    ['endsAt', { endsAt: new Date(Date.now() + 10 * 60_000) }],
    ['startedAt', { startedAt: new Date(Date.now() - 60_000) }],
    ['layout', { layout: { v: 1, q: ['x'], o: [[0]] } }],
    ['questionCount', { questionCount: 2 }],
    ['contentVersion', { contentVersion: 2 }],
  ])('never changes %s after the start', async (_field, data) => {
    const exam = await makePublishedExam(prisma);
    const a = await makeAttempt(prisma, (await makeUser(prisma)).id, exam.id);
    await expect(prisma.attempt.update({ where: { id: a.id }, data })).rejects.toThrow(
      /attempts_guard/,
    );
  });

  it('moves status only forward and never deletes', async () => {
    const exam = await makePublishedExam(prisma);
    const a = await makeAttempt(prisma, (await makeUser(prisma)).id, exam.id);
    await expect(
      prisma.attempt.update({ where: { id: a.id }, data: { status: 'scored', score: 1 } }),
    ).rejects.toThrow(/attempts_guard/);
    await prisma.attempt.update({
      where: { id: a.id },
      data: { status: 'expired', submittedAt: new Date() },
    });
    await prisma.attempt.update({ where: { id: a.id }, data: { status: 'scored', score: 1 } });
    await expect(
      prisma.attempt.update({ where: { id: a.id }, data: { status: 'submitted', score: null } }),
    ).rejects.toThrow(/attempts_guard/);
    await expect(prisma.attempt.delete({ where: { id: a.id } })).rejects.toThrow(/attempts_guard/);
  });

  it('ties status to submitted_at and score', async () => {
    const exam = await makePublishedExam(prisma);
    const a = await makeAttempt(prisma, (await makeUser(prisma)).id, exam.id);
    await expect(
      prisma.attempt.update({ where: { id: a.id }, data: { status: 'submitted' } }),
    ).rejects.toThrow(/attempts_submitted_at_check/);
    await prisma.attempt.update({
      where: { id: a.id },
      data: { status: 'submitted', submittedAt: new Date() },
    });
    await expect(
      prisma.attempt.update({ where: { id: a.id }, data: { status: 'scored' } }),
    ).rejects.toThrow(/attempts_scored_check/);
  });
});

describe('submissions', () => {
  async function attempt() {
    const exam = await makePublishedExam(prisma);
    return makeAttempt(prisma, (await makeUser(prisma)).id, exam.id);
  }

  it('makes the final submit idempotent by attempt_id and request_id', async () => {
    const a1 = await attempt();
    const a2 = await attempt();
    const requestId = randomUUID();
    await prisma.submission.create({ data: submissionData(a1.id, { requestId }) });
    await expect(prisma.submission.create({ data: submissionData(a1.id) })).rejects.toMatchObject(
      UNIQUE,
    );
    await expect(
      prisma.submission.create({ data: submissionData(a2.id, { requestId }) }),
    ).rejects.toMatchObject(UNIQUE);
  });

  it.each([
    ['answers {}', { answers: {} }, /submissions_answers_check/],
    ['answers as a bare list', { answers: [1, 2] }, /submissions_answers_check/],
    ['a request id with spaces', { requestId: 'not a valid id' }, /submissions_request_id_check/],
    ['a negative violation count', { violationCount: -1 }, /submissions_violation_count_check/],
  ])('refuses %s', async (_label, data, constraint) => {
    const a = await attempt();
    await expect(prisma.submission.create({ data: submissionData(a.id, data) })).rejects.toThrow(
      constraint,
    );
  });

  it('accepts the server finalize id and every end reason', async () => {
    for (const endReason of [
      'time_up',
      'violations',
      'server_checkpoint',
      'server_empty',
    ] as const) {
      const a = await attempt();
      await expect(
        prisma.submission.create({
          data: submissionData(a.id, { requestId: `auto.${a.id}`, endReason, violationCount: 6 }),
        }),
      ).resolves.toBeTruthy();
    }
  });

  it('is append-only: UPDATE and DELETE refused through Prisma and raw SQL', async () => {
    const a = await attempt();
    const s = await prisma.submission.create({ data: submissionData(a.id) });
    await expect(
      prisma.submission.update({ where: { id: s.id }, data: { violationCount: 0 } }),
    ).rejects.toThrow(/append-only: UPDATE/);
    await expect(prisma.submission.delete({ where: { id: s.id } })).rejects.toThrow(
      /append-only: DELETE/,
    );
    await expect(
      prisma.$executeRaw`UPDATE submissions SET violation_count = 9 WHERE id = ${s.id}::uuid`,
    ).rejects.toThrow(/append-only: UPDATE/);
  });

  it('allows TRUNCATE only because this is a *_test database (truncateAll)', async () => {
    const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    expect(row?.db).toMatch(/_test$/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE submissions')).resolves.toBeDefined();
  });
});

describe('leaderboard_entries', () => {
  it('keeps one row per position per generation and never loses its attempt', async () => {
    const exam = await makePublishedExam(prisma);
    const user = await makeUser(prisma);
    const a = await makeAttempt(prisma, user.id, exam.id);
    const row = {
      examId: exam.id,
      generation: 1,
      position: 1,
      rank: 1,
      userId: user.id,
      attemptId: a.id,
      name: user.name,
      score: 0,
      timeTakenSeconds: 60,
    };
    await prisma.leaderboardEntry.create({ data: row });
    await expect(prisma.leaderboardEntry.create({ data: row })).rejects.toMatchObject(UNIQUE);
  });
});
