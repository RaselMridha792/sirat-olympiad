/**
 * The next olympiad exam for the admit card (nextExamFor and GET /exams/next; core's admit card, the lead's 10 Nov
 * queue): the nearest published exam of a round whose window has not ended, visible to the student (category or
 * everyone; demo and real apart); never a practice exam, a draft or an ended exam; null when there is none.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { StudentNextExam } from '@sirat/shared';
import { nextExamFor } from '../src/modules/exams/next-exam';
import { bootCoreApp, call, sessionFor, type CoreApp } from './core-helpers';
import { makePublishedExam } from './exam-helpers';
import { applyReferenceData, makeUser, testPrisma } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let env: CoreApp;
let prisma: PrismaClient;
let round1: { id: string; name: string };
let demo: { batchId: string; roundId: string } | null = null;

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  if (!(await prisma.round.findUnique({ where: { sortOrder: 1 } })))
    await applyReferenceData(prisma);
  round1 = await prisma.round.findUniqueOrThrow({
    where: { sortOrder: 1 },
    select: { id: true, name: true },
  });
}, 60_000);

beforeEach(async () => {
  // Round exams other suites left published would count: archive them (the *_test database only).
  await prisma.$executeRaw`
    UPDATE "exams" SET "status" = 'archived' WHERE "status"::text = 'published' AND "round_id" IS NOT NULL`;
});

afterAll(async () => {
  if (prisma && demo) {
    await prisma.demoBatch.update({ where: { id: demo.batchId }, data: { status: 'loaded' } });
    await prisma.$queryRaw`SELECT demo_clear(${demo.batchId}::uuid)`;
  }
  await env?.app.close();
  await prisma?.$disconnect();
});

const exam = (data: Parameters<typeof makePublishedExam>[1]) =>
  makePublishedExam(prisma, { title: `Next ${randomUUID().slice(0, 6)}`, ...data });
const at = (ms: number) => new Date(Date.now() + ms);

describe('nextExamFor', () => {
  it('null without a round exam; a practice exam (no round) never counts', async () => {
    const student = await makeUser(prisma, { role: 'student', category: 'activist' });
    expect(await nextExamFor(prisma, student.id)).toBeNull();
    await exam({ roundId: null, windowStart: at(-DAY), windowEnd: at(30 * DAY) });
    expect(await nextExamFor(prisma, student.id)).toBeNull();
  });

  it('the nearest by start among visible round exams; never another category, a draft or an ended exam', async () => {
    const student = await makeUser(prisma, { role: 'student', category: 'activist' });
    await exam({
      roundId: round1.id,
      category: 'achiever',
      windowStart: at(HOUR),
      windowEnd: at(2 * HOUR),
    });
    await exam({ roundId: round1.id, windowStart: at(-3 * HOUR), windowEnd: at(-HOUR) }); // ended
    await prisma.exam.create({
      data: {
        title: 'Draft next',
        roundId: round1.id,
        windowStart: at(30 * 60_000),
        windowEnd: at(HOUR),
        durationMinutes: 30,
        questionsPerAttempt: 1,
      },
    });
    const later = await exam({
      roundId: round1.id,
      windowStart: at(3 * DAY),
      windowEnd: at(3 * DAY + HOUR),
    });
    const sooner = await exam({
      roundId: round1.id,
      category: 'activist',
      windowStart: at(DAY),
      windowEnd: at(DAY + 2 * HOUR),
      durationMinutes: 25,
    });
    const next = await nextExamFor(prisma, student.id);
    expect(next).toEqual<StudentNextExam>({
      examId: sooner.id,
      title: sooner.title,
      windowStart: sooner.windowStart.toISOString(),
      windowEnd: sooner.windowEnd.toISOString(),
      durationMinutes: 25,
      roundName: round1.name,
    });
    // An exam open right now (started, not ended) comes before both.
    const open = await exam({ roundId: round1.id, windowStart: at(-HOUR), windowEnd: at(HOUR) });
    expect((await nextExamFor(prisma, student.id))?.examId).toBe(open.id);
    // A student of no category sees only exams for everyone.
    const none = await makeUser(prisma, { role: 'student', category: null });
    await prisma.exam.update({ where: { id: open.id }, data: { status: 'archived' } });
    expect((await nextExamFor(prisma, none.id))?.examId).toBe(later.id);
  });

  it('null for a blocked or unknown account', async () => {
    await exam({ roundId: round1.id, windowStart: at(DAY), windowEnd: at(DAY + HOUR) });
    const blocked = await makeUser(prisma, { role: 'student', isBlocked: true });
    expect(await nextExamFor(prisma, blocked.id)).toBeNull();
    expect(await nextExamFor(prisma, randomUUID())).toBeNull();
  });

  it('keeps demo and real apart: a demo account sees only demo round exams, a real one only real ones', async () => {
    if ((await prisma.demoBatch.count()) > 0)
      throw new Error('a demo batch is left from another suite');
    const batch = await prisma.demoBatch.create({
      data: { status: 'loaded', reason: 'next exam test' },
    });
    const round = await prisma.round.create({
      data: { name: 'DEMO · Round 1', sortOrder: 101, type: 'quiz', demoBatchId: batch.id },
    });
    demo = { batchId: batch.id, roundId: round.id };
    const demoUser = await makeUser(prisma, {
      email: `s-${randomUUID().slice(0, 8)}@demo.sirat.invalid`,
      role: 'student',
      demoBatchId: batch.id,
    });
    const demoExam = await exam({
      roundId: round.id,
      demoBatchId: batch.id,
      windowStart: at(HOUR),
      windowEnd: at(2 * HOUR),
    });
    await prisma.demoRecord.createMany({
      data: [
        { batchId: batch.id, tableName: 'rounds', rowId: round.id },
        { batchId: batch.id, tableName: 'users', rowId: demoUser.id },
        { batchId: batch.id, tableName: 'exams', rowId: demoExam.id },
      ],
    });
    const realExam = await exam({
      roundId: round1.id,
      windowStart: at(DAY),
      windowEnd: at(DAY + HOUR),
    });
    const real = await makeUser(prisma, { role: 'student' });
    expect((await nextExamFor(prisma, demoUser.id))?.examId).toBe(demoExam.id);
    expect((await nextExamFor(prisma, real.id))?.examId).toBe(realExam.id);
  });
});

describe('GET /exams/next', () => {
  it('students and ambassadors get { exam }, "next" is never read as an id; 401 without a session, 403 for staff', async () => {
    const e = await exam({
      roundId: round1.id,
      windowStart: at(2 * DAY),
      windowEnd: at(2 * DAY + HOUR),
    });
    for (const role of ['student', 'ambassador'] as const) {
      const s = await sessionFor(env, prisma, { role });
      const res = await call<{ exam: StudentNextExam | null }>(env, 'GET', '/exams/next', s.cookie);
      expect(res.status).toBe(200);
      expect(res.json.exam?.examId).toBe(e.id);
    }
    await prisma.exam.update({ where: { id: e.id }, data: { status: 'archived' } });
    const s = await sessionFor(env, prisma, { role: 'student' });
    expect((await call(env, 'GET', '/exams/next', s.cookie)).json).toEqual({ exam: null });
    expect((await call(env, 'GET', '/exams/next', '')).status).toBe(401);
    for (const role of ['admin', 'manager', 'jury'] as const) {
      const staff = await sessionFor(env, prisma, { role });
      expect((await call(env, 'GET', '/exams/next', staff.cookie)).status).toBe(403);
    }
  });
});
