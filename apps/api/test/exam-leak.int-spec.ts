/**
 * The required leak test (RULEBOOK §7, §18; EXAM-PLAN 6.1): no correct answer, explanation, score or time taken
 * reaches a student before the results are published. Every student response of the exam engine is scanned for the
 * field names and for canary values planted in the database, the leaderboard and the review included (E3).
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { AttemptView } from '@sirat/shared';
import { makeUser, testPrisma } from './helpers';
import { bootEngineApp, call, type EngineApp, loginAs, seedExam } from './exam-engine-app';

let env: EngineApp;
let prisma: PrismaClient;

beforeAll(async () => {
  env = await bootEngineApp(0);
  prisma = testPrisma();
}, 60_000);

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

const FORBIDDEN_FIELDS =
  /"(correctKey|correct_key|explanation|score|timeTaken\w*|time_taken\w*|key|lineageId|layout)"\s*:/;

describe('nothing secret reaches a student before results', () => {
  it('scans every exam-engine response for answers, explanations, scores and canaries', async () => {
    const canary = `CANARY-${randomUUID().slice(0, 8)}`;
    const { exam, questions } = await seedExam(env, prisma, {
      count: 3,
      question: (i) => ({ explanation: `${canary}-explanation-${i}` }),
    });
    // Another student already scored, with a distinctive time: neither may show up anywhere.
    const rival = await makeUser(prisma, { role: 'student' });
    const rivalAttempt = await prisma.attempt.create({
      data: {
        userId: rival.id,
        examId: exam.id,
        startedAt: new Date(Date.now() - 20 * 60_000),
        endsAt: new Date(Date.now() + 10 * 60_000),
        layout: { v: 1, q: [], o: [] },
        questionCount: 3,
        contentVersion: exam.contentVersion,
      },
    });
    await prisma.attempt.update({
      where: { id: rivalAttempt.id },
      data: { status: 'submitted', submittedAt: new Date(), timeTakenSeconds: 1171 },
    });
    await prisma.attempt.update({
      where: { id: rivalAttempt.id },
      data: { status: 'scored', score: 3 },
    });

    const student = await loginAs(env, prisma);
    const responses: Array<{ label: string; text: string }> = [];
    const record = async (label: string, method: string, path: string, body?: unknown) => {
      const res = await call(env, method, path, student.cookie, body);
      responses.push({ label, text: res.text });
      return res;
    };

    await record('GET /exams', 'GET', '/exams');
    await record('GET /exams/:id', 'GET', `/exams/${exam.id}`);
    const started = await record('start', 'POST', `/exams/${exam.id}/attempts`);
    const view = started.json as AttemptView;
    await record('resume', 'GET', `/attempts/me?exam=${exam.id}`);
    await record('checkpoint', 'PUT', `/attempts/${view.attemptId}/checkpoint`, {
      seq: 1,
      answers: [0, 1, 2],
      violationCount: 0,
      events: [],
    });
    await record('submit', 'POST', `/attempts/${view.attemptId}/submit`, {
      requestId: randomUUID(),
      answers: [0, 1, 2],
      endReason: 'submitted',
      violationCount: 0,
      events: [],
    });
    await record('start after submit', 'POST', `/exams/${exam.id}/attempts`);
    await record('GET /exams/:id after submit', 'GET', `/exams/${exam.id}`);
    // E3: before the results are published, the leaderboard is empty and the review is refused.
    const board = await record(
      'leaderboard before publishing',
      'GET',
      `/leaderboard?exam=${exam.id}`,
    );
    expect(board.json).toMatchObject({ status: 'unpublished', items: [] });
    const review = await record(
      'review before publishing',
      'GET',
      `/attempts/${view.attemptId}/review`,
    );
    expect(review.status).toBe(403);

    for (const { label, text } of responses) {
      expect({ label, leak: FORBIDDEN_FIELDS.exec(text)?.[0] ?? null }).toEqual({
        label,
        leak: null,
      });
      expect({ label, canary: text.includes(canary) }).toEqual({ label, canary: false });
      expect({ label, rivalTime: text.includes('1171') }).toEqual({ label, rivalTime: false });
      for (const q of questions)
        expect({ label, id: text.includes(q.id) }).toEqual({ label, id: false });
    }
    // The questions the student did see carry texts only.
    for (const q of view.questions) expect(Object.keys(q).sort()).toEqual(['options', 'text']);
    expect(view.questions.every((q) => q.options.every((o) => typeof o === 'string'))).toBe(true);
  });

  it('spreads the correct option evenly over the displayed positions (the order leaks nothing)', async () => {
    const { exam, questions } = await seedExam(env, prisma, { count: 1 });
    const correctText = questions[0]!.options.find((o) => o.key === questions[0]!.correctKey)!.text;
    const counts = [0, 0, 0, 0];
    const runs = 200;
    for (let i = 0; i < runs; i++) {
      const { cookie } = await loginAs(env, prisma);
      const view = (await call<AttemptView>(env, 'POST', `/exams/${exam.id}/attempts`, cookie))
        .json;
      counts[view.questions[0]!.options.indexOf(correctText)]! += 1;
    }
    const expected = runs / 4;
    const chiSquare = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    // 3 degrees of freedom: 20 is far beyond p = 0.001 (16.27), so a fair shuffle fails this about once in 6,000 runs.
    expect({ counts, fair: chiSquare < 20 }).toEqual({ counts, fair: true });
    expect(counts.every((c) => c > 0)).toBe(true);
  });
});
