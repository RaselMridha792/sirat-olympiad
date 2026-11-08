/**
 * The admin exam preview (D2, P1): one sample draw as a student's start would draw and show it, with the correct
 * positions, for admins only, and nothing written: no attempt, no checkpoint, no cache, no audit row.
 */
import type { PrismaClient } from '@prisma/client';
import type { AdminExamPreview, ApiError, AttemptView } from '@sirat/shared';
import { testPrisma } from './helpers';
import {
  bootEngineApp,
  call,
  closeEngineApp,
  type EngineApp,
  loginAs,
  seedExam,
  type SeededQuestion,
} from './exam-engine-app';

jest.setTimeout(120_000);

let env: EngineApp;
let prisma: PrismaClient;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootEngineApp(0);
  prisma = testPrisma();
  admin = await loginAs(env, prisma, { role: 'admin' }, { registered: false });
}, 60_000);

afterAll(async () => {
  await closeEngineApp(env);
  await prisma?.$disconnect();
});

const preview = (examId: string, cookie = admin.cookie) =>
  call<AdminExamPreview & ApiError>(env, 'GET', `/admin/exams/${examId}/preview`, cookie);

/** The displayed text of the correct option, from the seeded key (or a corrected one). */
const correctText = (q: SeededQuestion, key = q.correctKey) =>
  q.options.find((o) => o.key === key)!.text;

/** Everything a preview could leave behind for this exam. */
async function traces(examId: string) {
  const [attempts, audits] = await Promise.all([
    prisma.attempt.count({ where: { examId } }),
    prisma.auditLog.count({ where: { entityId: examId } }),
  ]);
  const [att, ckpt] = await Promise.all([
    env.redis.keys('exam:att:*'),
    env.redis.keys('exam:ckpt:*'),
  ]);
  return { attempts, audits, redisAttemptKeys: att.length + ckpt.length };
}

describe('who may preview', () => {
  it('refuses without a session (401), and for a manager or a student (403)', async () => {
    const { exam } = await seedExam(env, prisma, { count: 2 });
    expect((await preview(exam.id, '')).status).toBe(401);
    const manager = await loginAs(env, prisma, { role: 'manager' }, { registered: false });
    expect((await preview(exam.id, manager.cookie)).status).toBe(403);
    const student = await loginAs(env, prisma);
    expect((await preview(exam.id, student.cookie)).status).toBe(403);
    expect((await preview('00000000-0000-7000-8000-000000000000')).status).toBe(404);
  });
});

describe('the draw', () => {
  it('shows every question of a fixed exam, with the correct positions, and writes nothing', async () => {
    const { exam, questions } = await seedExam(env, prisma, { count: 4 });
    const before = await traces(exam.id);
    const res = await preview(exam.id);
    expect(res.status).toBe(200);
    expect(await traces(exam.id)).toEqual(before);

    // Exactly the admin shape: no attempt id, receipt, request id or token of any kind.
    expect(Object.keys(res.json).sort()).toEqual(
      [
        'correct',
        'durationMinutes',
        'examId',
        'questions',
        'questionsPerAttempt',
        'status',
        'title',
        'violationWarnings',
      ].sort(),
    );
    expect(res.text).not.toMatch(/"attemptId"|receipt|requestId|token|lineageId|"key"|correctKey/i);
    expect(res.json).toMatchObject({
      examId: exam.id,
      status: 'published',
      questionsPerAttempt: 4,
      violationWarnings: 5,
    });

    expect(res.json.questions).toHaveLength(4);
    expect(new Set(res.json.questions.map((q) => q.text))).toEqual(
      new Set(questions.map((q) => q.text)),
    );
    for (const [i, shown] of res.json.questions.entries()) {
      const q = questions.find((x) => x.text === shown.text)!;
      expect(new Set(shown.options)).toEqual(new Set(q.options.map((o) => o.text)));
      expect(shown.options[res.json.correct[i]!]).toBe(correctText(q));
    }
  });

  it('draws N of a larger pool, distinct, and keeps a question’s option order when asked', async () => {
    const { exam, questions } = await seedExam(env, prisma, {
      count: 6,
      questionsPerAttempt: 3,
      randomDraw: true,
      question: () => ({ keepOptionOrder: true }),
    });
    for (let run = 0; run < 5; run++) {
      const res = await preview(exam.id);
      expect(res.status).toBe(200);
      expect(res.json.questions).toHaveLength(3);
      expect(new Set(res.json.questions.map((q) => q.text)).size).toBe(3);
      for (const shown of res.json.questions) {
        const q = questions.find((x) => x.text === shown.text)!;
        expect(shown.options).toEqual(q.options.map((o) => o.text)); // A, B, C, D as written
      }
    }
  });

  it('marks the corrected key after an answer-key correction (E7b)', async () => {
    const { exam, questions } = await seedExam(env, prisma, { count: 1 });
    await prisma.answerKeyCorrection.create({
      data: {
        examId: exam.id,
        questionId: questions[0]!.id,
        fromKey: 'C',
        toKey: 'A',
        reason: 'The printed key was wrong',
        createdById: admin.id,
      },
    });
    const res = await preview(exam.id);
    expect(res.json.questions[0]!.options[res.json.correct[0]!]).toBe(
      correctText(questions[0]!, 'A'),
    );
  });
});

describe('a short pool', () => {
  it('shows what a draft has, and refuses a published exam whose pool is short (question_count)', async () => {
    const draft = await seedExam(env, prisma, {
      count: 2,
      questionsPerAttempt: 3,
      data: { status: 'draft' },
    });
    const res = await preview(draft.exam.id);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: 'draft', questionsPerAttempt: 3 });
    expect(res.json.questions).toHaveLength(2);
    expect(res.json.correct).toHaveLength(2);

    const empty = await seedExam(env, prisma, {
      count: 0,
      questionsPerAttempt: 2,
      data: { status: 'draft' },
    });
    expect((await preview(empty.exam.id)).json).toMatchObject({ questions: [], correct: [] });

    const published = await seedExam(env, prisma, { count: 2, questionsPerAttempt: 3 });
    expect(await preview(published.exam.id)).toMatchObject({
      status: 409,
      json: { details: ['question_count'] },
    });
  });
});

describe('the student side is unchanged', () => {
  it('leaves a student’s own start and view as they were', async () => {
    const { exam } = await seedExam(env, prisma, { count: 3 });
    expect((await preview(exam.id)).status).toBe(200);
    const student = await loginAs(env, prisma);
    const started = await call<AttemptView>(
      env,
      'POST',
      `/exams/${exam.id}/attempts`,
      student.cookie,
    );
    expect(started.status).toBe(201);
    expect(started.json.questions).toHaveLength(3);
    // The student shape still carries texts only, and the review stays closed until results are published.
    expect(started.text).not.toMatch(/"correct"|correctKey/);
    const review = await call<ApiError>(
      env,
      'GET',
      `/attempts/${started.json.attemptId}/review`,
      student.cookie,
    );
    expect(review).toMatchObject({ status: 403, json: { details: ['results_not_published'] } });
    // The admin who previewed has no attempt anywhere.
    expect(await prisma.attempt.count({ where: { userId: admin.id } })).toBe(0);
  });
});
