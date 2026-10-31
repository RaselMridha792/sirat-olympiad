/**
 * Taking an exam over HTTP (06-API "Exam engine"; EXAM-PLAN section 3 and 3.15): who may start, the server's window
 * and timer, the same questions for everyone, resume, Redis-only checkpoints, the idempotent submit, the grace and the
 * violation count that never resets.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  ApiError,
  AttemptView,
  CheckpointResult,
  StudentExamDetail,
  StudentExamListItem,
  SubmitResult,
} from '@sirat/shared';
import { testPrisma } from './helpers';
import { bootEngineApp, call, type EngineApp, HOUR_MS, loginAs, seedExam } from './exam-engine-app';

const INTERVAL_MS = 1_500;
// Heavy or timing-sensitive on a shared machine (many starts, short real waits): a generous limit, not the 30 s default.
jest.setTimeout(180_000);

let env: EngineApp;
let prisma: PrismaClient;

beforeAll(async () => {
  env = await bootEngineApp(INTERVAL_MS);
  prisma = testPrisma();
}, 60_000);

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

const start = (examId: string, cookie: string) =>
  call<AttemptView>(env, 'POST', `/exams/${examId}/attempts`, cookie);
const checkpoint = (attemptId: string, cookie: string, body: Record<string, unknown>) =>
  call<CheckpointResult>(env, 'PUT', `/attempts/${attemptId}/checkpoint`, cookie, {
    violationCount: 0,
    events: [],
    ...body,
  });
const submit = (attemptId: string, cookie: string, body: Record<string, unknown>) =>
  call<SubmitResult>(env, 'POST', `/attempts/${attemptId}/submit`, cookie, {
    requestId: randomUUID(),
    endReason: 'submitted',
    violationCount: 0,
    events: [],
    ...body,
  });
const blank = (n: number) => Array.from({ length: n }, () => null);

describe('who may take an exam', () => {
  it('refuses admins and managers (403)', async () => {
    const { exam } = await seedExam(env, prisma);
    for (const role of ['admin', 'manager'] as const) {
      const { cookie } = await loginAs(env, prisma, { role });
      expect((await call(env, 'GET', '/exams', cookie)).status).toBe(403);
      expect((await start(exam.id, cookie)).status).toBe(403);
    }
  });

  it('refuses a blocked student with a valid token, and an unverified email at the start', async () => {
    const { exam } = await seedExam(env, prisma);
    const blocked = await loginAs(env, prisma, { isBlocked: true });
    expect(await call<ApiError>(env, 'GET', '/exams', blocked.cookie)).toMatchObject({
      status: 403,
      json: { details: ['account_blocked'] },
    });
    const unverified = await loginAs(env, prisma, { emailVerifiedAt: null });
    expect((await call(env, 'GET', '/exams', unverified.cookie)).status).toBe(200);
    expect(await start(exam.id, unverified.cookie)).toMatchObject({
      status: 403,
      json: { details: ['email_unverified'] },
    });
  });

  it('needs a paid registration to start (EXAM-PLAN D3)', async () => {
    const { exam } = await seedExam(env, prisma);
    const unregistered = await loginAs(env, prisma, {}, { registered: false });
    expect((await call(env, 'GET', '/exams', unregistered.cookie)).status).toBe(200);
    expect(await start(exam.id, unregistered.cookie)).toMatchObject({
      status: 403,
      json: { details: ['registration_required'] },
    });
    expect(await prisma.attempt.count({ where: { userId: unregistered.id } })).toBe(0);
  });

  it('shows only published exams for everyone or the own category; others are 404', async () => {
    const mine = await seedExam(env, prisma, { data: { category: 'activist' } });
    const all = await seedExam(env, prisma);
    const other = await seedExam(env, prisma, { data: { category: 'achiever' } });
    const draft = await seedExam(env, prisma, { data: { status: 'draft' } });
    const student = await loginAs(env, prisma);

    const list = await call<StudentExamListItem[]>(env, 'GET', '/exams', student.cookie);
    const ids = list.json.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([mine.exam.id, all.exam.id]));
    expect(ids).not.toContain(other.exam.id);
    expect(ids).not.toContain(draft.exam.id);
    expect(list.json.find((e) => e.id === mine.exam.id)).toMatchObject({
      state: 'open',
      resultsPublished: false,
    });

    for (const id of [other.exam.id, draft.exam.id]) {
      expect((await call(env, 'GET', `/exams/${id}`, student.cookie)).status).toBe(404);
      expect((await start(id, student.cookie)).status).toBe(404);
    }
  });
});

describe('starting (server clock, owner Q2)', () => {
  it('refuses before the window opens and after it closes', async () => {
    const soon = await seedExam(env, prisma, {
      data: {
        windowStart: new Date(Date.now() + HOUR_MS),
        windowEnd: new Date(Date.now() + 9 * HOUR_MS),
      },
    });
    const past = await seedExam(env, prisma, {
      data: {
        windowStart: new Date(Date.now() - 9 * HOUR_MS),
        windowEnd: new Date(Date.now() - HOUR_MS),
      },
    });
    const { cookie } = await loginAs(env, prisma);
    expect(await start(soon.exam.id, cookie)).toMatchObject({
      status: 409,
      json: { details: ['not_open_yet'] },
    });
    expect(await start(past.exam.id, cookie)).toMatchObject({
      status: 409,
      json: { details: ['window_closed'] },
    });
    const states = (await call<StudentExamListItem[]>(env, 'GET', '/exams', cookie)).json;
    expect(states.find((e) => e.id === soon.exam.id)?.state).toBe('upcoming');
  });

  it('starts once with the server times; the same request later resumes', async () => {
    const { exam, questions } = await seedExam(env, prisma, { count: 4 });
    const { cookie } = await loginAs(env, prisma);
    const first = await start(exam.id, cookie);
    expect(first.status).toBe(201);
    const view = first.json;
    expect(view).toMatchObject({
      phase: 'in_progress',
      answers: null,
      violationCount: 0,
      violationWarnings: 5,
    });
    expect(view.questions).toHaveLength(4);
    expect(view.remainingSeconds).toBeGreaterThan(30 * 60 - 5);
    expect(view.remainingSeconds).toBeLessThanOrEqual(30 * 60);
    const stored = await prisma.attempt.findUniqueOrThrow({ where: { id: view.attemptId } });
    expect(stored.endsAt.getTime() - stored.startedAt.getTime()).toBe(30 * 60_000);
    expect(new Set(view.questions.map((q) => q.text))).toEqual(
      new Set(questions.map((q) => q.text)),
    );

    const again = await start(exam.id, cookie);
    expect(again.status).toBe(200);
    expect(again.json.attemptId).toBe(view.attemptId);
    expect(again.json.questions).toEqual(view.questions);
  });

  it('creates exactly one attempt for ten parallel starts', async () => {
    const { exam } = await seedExam(env, prisma);
    const { id, cookie } = await loginAs(env, prisma);
    const results = await Promise.all(Array.from({ length: 10 }, () => start(exam.id, cookie)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.json.attemptId)).size).toBe(1);
    expect(await prisma.attempt.count({ where: { userId: id, examId: exam.id } })).toBe(1);
  });

  it('gives a late starter only the time left in the window', async () => {
    const windowEnd = new Date(Date.now() + 5 * 60_000);
    const { exam } = await seedExam(env, prisma, { data: { windowEnd } });
    const { cookie } = await loginAs(env, prisma);
    const view = (await start(exam.id, cookie)).json;
    expect(new Date(view.endsAt).getTime()).toBe(windowEnd.getTime());
    expect(view.remainingSeconds).toBeLessThanOrEqual(5 * 60);
  });

  it('gives everyone the same questions in their own order; a random draw only when chosen', async () => {
    const fixed = await seedExam(env, prisma, { count: 5 });
    const orders = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const { cookie } = await loginAs(env, prisma);
      const texts = (await start(fixed.exam.id, cookie)).json.questions.map((q) => q.text);
      expect([...texts].sort()).toEqual(fixed.questions.map((q) => q.text).sort());
      orders.add(texts.join('|'));
    }
    expect(orders.size).toBeGreaterThan(1);

    const pool = await seedExam(env, prisma, {
      count: 5,
      questionsPerAttempt: 3,
      randomDraw: true,
    });
    const { cookie } = await loginAs(env, prisma);
    const drawn = (await start(pool.exam.id, cookie)).json.questions.map((q) => q.text);
    expect(drawn).toHaveLength(3);
    expect(pool.questions.map((q) => q.text)).toEqual(expect.arrayContaining(drawn));
  });

  it('keeps a started attempt on its question versions; later starts get the new version', async () => {
    const { exam, questions } = await seedExam(env, prisma, { count: 2 });
    const early = await loginAs(env, prisma);
    const before = (await start(exam.id, early.cookie)).json;

    const old = questions[0]!;
    const lineage = await prisma.question.findUniqueOrThrow({ where: { id: old.id } });
    await prisma.question.update({
      where: { id: old.id },
      data: { isActive: false, deactivatedAt: new Date() },
    });
    await prisma.question.create({
      data: {
        examId: exam.id,
        lineageId: lineage.lineageId,
        version: 2,
        position: lineage.position,
        text: `${old.text} (v2)`,
        options: old.options,
        correctKey: 'A',
      },
    });
    await env.redis.del(`exam:cfg:${exam.id}`);

    const resumed = await call<AttemptView>(
      env,
      'GET',
      `/attempts/me?exam=${exam.id}`,
      early.cookie,
    );
    expect(resumed.json.questions).toEqual(before.questions);
    const late = await loginAs(env, prisma);
    const texts = (await start(exam.id, late.cookie)).json.questions.map((q) => q.text);
    expect(texts).toContain(`${old.text} (v2)`);
    expect(texts).not.toContain(old.text);
  });
});

describe('checkpoints (Redis only)', () => {
  async function started(count = 3) {
    const { exam } = await seedExam(env, prisma, { count });
    const student = await loginAs(env, prisma);
    const view = (await start(exam.id, student.cookie)).json;
    return { exam, student, view };
  }

  it('writes nothing to the database', async () => {
    const { student, view } = await started();
    env.appPrisma.statements.length = 0;
    const res = await checkpoint(view.attemptId, student.cookie, { seq: 1, answers: [1, null, 0] });
    expect(res).toMatchObject({ status: 200, json: { savedSeq: 1, violationCount: 0 } });
    expect(env.appPrisma.statements).toEqual([]);
  });

  it('keeps the newest seq, throttles bursts, and never lowers the violation count', async () => {
    const { student, view } = await started();
    expect(
      (await checkpoint(view.attemptId, student.cookie, { seq: 5, answers: [0, 0, 0] })).json
        .savedSeq,
    ).toBe(5);

    const soon = await checkpoint(view.attemptId, student.cookie, {
      seq: 6,
      answers: [1, 1, 1],
      violationCount: 2,
      events: [
        { type: 'leave', at: 30 },
        { type: 'leave', at: 60 },
      ],
    });
    expect(soon).toMatchObject({ status: 429, json: { details: ['too_soon'] } });
    expect(Number(soon.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);

    await sleep(INTERVAL_MS + 100);
    const older = await checkpoint(view.attemptId, student.cookie, {
      seq: 4,
      answers: [2, 2, 2],
      violationCount: 1,
    });
    expect(older.json).toMatchObject({ savedSeq: 5, violationCount: 2 });

    const resumed = (
      await call<AttemptView>(env, 'GET', `/attempts/me?exam=${view.examId}`, student.cookie)
    ).json;
    expect(resumed).toMatchObject({ answers: [0, 0, 0], savedSeq: 5, violationCount: 2 });
  });

  it("refuses answers that do not fit the attempt, and another student's attempt", async () => {
    const { student, view } = await started();
    for (const answers of [
      [0, 0],
      [0, 0, 4],
      [0, 0, -1],
      ['A', 0, 0],
    ])
      expect(await checkpoint(view.attemptId, student.cookie, { seq: 1, answers })).toMatchObject({
        status: 400,
      });
    const stranger = await loginAs(env, prisma);
    expect(
      (await checkpoint(view.attemptId, stranger.cookie, { seq: 1, answers: blank(3) })).status,
    ).toBe(404);
    expect((await submit(view.attemptId, stranger.cookie, { answers: blank(3) })).status).toBe(404);
  });

  it('refuses after the grace, and after the submit', async () => {
    const { exam } = await seedExam(env, prisma, {
      count: 1,
      data: { windowEnd: new Date(Date.now() + 2_000), graceSeconds: 0 },
    });
    const student = await loginAs(env, prisma);
    const view = (await start(exam.id, student.cookie)).json;
    await sleep(2_300);
    expect(
      await checkpoint(view.attemptId, student.cookie, { seq: 1, answers: [0] }),
    ).toMatchObject({
      status: 409,
      json: { details: ['time_over'] },
    });
    expect(await submit(view.attemptId, student.cookie, { answers: [0] })).toMatchObject({
      status: 409,
      json: { details: ['time_over'] },
    });

    const { student: s2, view: v2 } = await started(1);
    expect((await submit(v2.attemptId, s2.cookie, { answers: [0] })).status).toBe(200);
    expect(await checkpoint(v2.attemptId, s2.cookie, { seq: 9, answers: [0] })).toMatchObject({
      status: 409,
      json: { details: ['already_submitted'] },
    });
  });
});

describe('the final submit', () => {
  async function started(count = 3) {
    const { exam } = await seedExam(env, prisma, { count });
    const student = await loginAs(env, prisma);
    const view = (await start(exam.id, student.cookie)).json;
    return { exam, student, view };
  }

  it('stores exactly the answers sent and the server time, once', async () => {
    const { student, view } = await started();
    const requestId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        submit(view.attemptId, student.cookie, { requestId, answers: [2, null, 1] }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.json.receiptId)).size).toBe(1);
    expect(results.filter((r) => !r.json.alreadySubmitted)).toHaveLength(1);

    const row = await prisma.submission.findUniqueOrThrow({ where: { attemptId: view.attemptId } });
    expect(row).toMatchObject({
      requestId,
      answers: { v: 1, a: [2, null, 1] },
      endReason: 'submitted',
    });
    const attempt = await prisma.attempt.findUniqueOrThrow({ where: { id: view.attemptId } });
    expect(attempt.status).toBe('submitted');
    expect(attempt.timeTakenSeconds).toBeGreaterThanOrEqual(0);
    expect(attempt.timeTakenSeconds).toBeLessThan(60);

    const later = await submit(view.attemptId, student.cookie, { answers: [0, 0, 0] });
    expect(later.json).toMatchObject({
      receiptId: results[0]!.json.receiptId,
      alreadySubmitted: true,
    });
  });

  it("refuses client-side time, score or identity fields, and another attempt's request id", async () => {
    const { student, view } = await started();
    for (const extra of [
      { score: 3 },
      { timeTakenSeconds: 1 },
      { userId: student.id },
      { endReason: 'server_empty' },
    ])
      expect(
        (await submit(view.attemptId, student.cookie, { answers: blank(3), ...extra })).status,
      ).toBe(400);

    const other = await started();
    const requestId = randomUUID();
    expect(
      (await submit(other.view.attemptId, other.student.cookie, { requestId, answers: blank(3) }))
        .status,
    ).toBe(200);
    expect(
      await submit(view.attemptId, student.cookie, { requestId, answers: blank(3) }),
    ).toMatchObject({
      status: 409,
      json: { details: ['request_id_conflict'] },
    });
  });

  it('shows the receipt, never the questions, once submitted', async () => {
    const { exam, student, view } = await started();
    const receipt = (await submit(view.attemptId, student.cookie, { answers: blank(3) })).json;
    const again = await start(exam.id, student.cookie);
    expect(again).toMatchObject({
      status: 200,
      json: { phase: 'submitted', questions: [], answers: null },
    });
    expect(again.json.receipt).toMatchObject({
      receiptId: receipt.receiptId,
      endReason: 'submitted',
    });
    const detail = await call<StudentExamDetail>(env, 'GET', `/exams/${exam.id}`, student.cookie);
    expect(detail.json).toMatchObject({ state: 'submitted', attempt: { phase: 'submitted' } });
  });
});

describe('rule violations (owner Q4)', () => {
  it('keeps the count across a reload and on another device', async () => {
    const { exam } = await seedExam(env, prisma);
    const student = await loginAs(env, prisma);
    const view = (await start(exam.id, student.cookie)).json;
    await checkpoint(view.attemptId, student.cookie, {
      seq: 1,
      answers: blank(3),
      violationCount: 3,
      events: [
        { type: 'leave', at: 10 },
        { type: 'devtools', at: 20 },
        { type: 'leave', at: 30 },
      ],
    });
    const reload = (
      await call<AttemptView>(env, 'GET', `/attempts/me?exam=${exam.id}`, student.cookie)
    ).json;
    expect(reload.violationCount).toBe(3);
    const issued = await env.sessions.start(
      { id: student.id, role: 'student' },
      { ip: '198.51.100.4', userAgent: 'phone' },
    );
    const otherDevice = await start(exam.id, `sirat_access=${issued.accessToken}`);
    expect(otherDevice.json.violationCount).toBe(3);
  });

  it('submits the real answers after the 6th violation, with the reason and the events', async () => {
    const { exam } = await seedExam(env, prisma);
    const student = await loginAs(env, prisma);
    const view = (await start(exam.id, student.cookie)).json;
    const events = Array.from({ length: 6 }, (_, i) => ({
      type: 'leave' as const,
      at: 10 * (i + 1),
    }));

    expect(
      await submit(view.attemptId, student.cookie, {
        answers: [2, null, 1],
        endReason: 'violations',
        violationCount: 5,
      }),
    ).toMatchObject({ status: 400, json: { details: ['violations_not_reached'] } });

    const res = await submit(view.attemptId, student.cookie, {
      answers: [2, null, 1],
      endReason: 'violations',
      violationCount: 6,
      events,
    });
    expect(res).toMatchObject({ status: 200, json: { endReason: 'violations' } });
    const row = await prisma.submission.findUniqueOrThrow({ where: { attemptId: view.attemptId } });
    expect(row).toMatchObject({
      answers: { v: 1, a: [2, null, 1] },
      endReason: 'violations',
      violationCount: 6,
      events,
    });
  });

  it("takes the server's higher count when the client sends a lower one", async () => {
    const { exam } = await seedExam(env, prisma);
    const student = await loginAs(env, prisma);
    const view = (await start(exam.id, student.cookie)).json;
    await checkpoint(view.attemptId, student.cookie, {
      seq: 1,
      answers: blank(3),
      violationCount: 4,
    });
    await submit(view.attemptId, student.cookie, { answers: blank(3), violationCount: 0 });
    const row = await prisma.submission.findUniqueOrThrow({ where: { attemptId: view.attemptId } });
    expect(row.violationCount).toBe(4);
  });
});
