/**
 * The round rule (lead, 10 Nov): an exam in a round that is not its side's first round (real Round 1, the demo's own
 * Round 1 at 101) is visible and startable only to students with a non-eliminated entry in that round. One predicate
 * (student-access.ts visibleTo / roundOpenTo) for the list, the waiting room, the start and nextExamFor.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { StudentExamListItem } from '@sirat/shared';
import { nextExamFor } from '../src/modules/exams/next-exam';
import { REDIS_CACHE } from '../src/redis/redis.module';
import { bootCoreApp, call, sessionFor, type CoreApp } from './core-helpers';
import { makePublishedExam } from './exam-helpers';
import { applyReferenceData, makeUser, testPrisma, truncateAll } from './helpers';

const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.now() + ms);
let env: CoreApp;
let prisma: PrismaClient;

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  if (!(await prisma.round.findUnique({ where: { sortOrder: 1 } })))
    await applyReferenceData(prisma);
  await prisma.$executeRaw`
    UPDATE "exams" SET "status" = 'archived' WHERE "status"::text = 'published' AND "round_id" IS NOT NULL`;
}, 60_000);

beforeEach(async () => {
  // Configs are cached for 60 s: each test reads what it made.
  const redis = env.app.get(REDIS_CACHE);
  const keys = await redis.keys('exam:*');
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  // A real round after Round 1 with a published exam cannot be removed row by row (the exam pins it), and the demo
  // load refuses beside one: the *_test database is emptied as other suites do, then the reference data comes back.
  if (prisma) {
    await truncateAll(prisma);
    await applyReferenceData(prisma);
  }
  await env?.app.close();
  await prisma?.$disconnect();
});

const list = async (cookie: string) =>
  (await call<StudentExamListItem[]>(env, 'GET', '/exams', cookie)).json.map((e) => e.id);

async function student(data: Parameters<typeof makeUser>[1] = {}) {
  const s = await sessionFor(env, prisma, { role: 'student', ...data });
  return { ...s, cookie: s.cookie };
}

describe('the round rule', () => {
  it('real side: a Round 2 exam only for students with a non-eliminated Round 2 entry; Round 1 stays open', async () => {
    const round1 = await prisma.round.findUniqueOrThrow({ where: { sortOrder: 1 } });
    const round2 = await prisma.round.create({
      data: { name: 'Round 2 (quiz)', sortOrder: 2, type: 'final' },
    });
    const r1Exam = await makePublishedExam(prisma, {
      title: `R1 ${randomUUID().slice(0, 6)}`,
      roundId: round1.id,
      windowStart: at(2 * HOUR),
      windowEnd: at(3 * HOUR),
    });
    const r2Exam = await makePublishedExam(prisma, {
      title: `R2 ${randomUUID().slice(0, 6)}`,
      roundId: round2.id,
      windowStart: at(-HOUR),
      windowEnd: at(HOUR),
    });
    const none = await student();
    const promoted = await student();
    const eliminated = await student();
    await prisma.roundEntry.createMany({
      data: [
        { userId: promoted.id, roundId: round2.id, status: 'pending' },
        { userId: eliminated.id, roundId: round2.id, status: 'eliminated' },
      ],
    });

    for (const s of [none, eliminated]) {
      const ids = await list(s.cookie);
      expect(ids).toContain(r1Exam.id);
      expect(ids).not.toContain(r2Exam.id);
      expect((await call(env, 'GET', `/exams/${r2Exam.id}`, s.cookie)).status).toBe(404);
      expect((await call(env, 'POST', `/exams/${r2Exam.id}/attempts`, s.cookie)).status).toBe(404);
      expect((await nextExamFor(prisma, s.id))?.examId).toBe(r1Exam.id);
    }
    expect(await list(promoted.cookie)).toEqual(expect.arrayContaining([r1Exam.id, r2Exam.id]));
    expect((await call(env, 'GET', `/exams/${r2Exam.id}`, promoted.cookie)).status).toBe(200);
    // Past the round rule: the start now stops at the next check (no paid registration), not at 404.
    const start = await call<{ details?: string[] }>(
      env,
      'POST',
      `/exams/${r2Exam.id}/attempts`,
      promoted.cookie,
    );
    expect(start.status).toBe(403);
    expect((await nextExamFor(prisma, promoted.id))?.examId).toBe(r2Exam.id); // open now, so nearest
  });

  it("demo side: the demo's own Round 1 (101) is open to every demo student, its next round only with an entry", async () => {
    if ((await prisma.demoBatch.count()) > 0)
      throw new Error('a demo batch is left from another suite');
    const batch = await prisma.demoBatch.create({
      data: { status: 'loaded', reason: 'round rule test' },
    });
    const d1 = await prisma.round.create({
      data: { name: 'DEMO · Round 1', sortOrder: 101, type: 'quiz', demoBatchId: batch.id },
    });
    const d2 = await prisma.round.create({
      data: { name: 'DEMO · Final', sortOrder: 102, type: 'final', demoBatchId: batch.id },
    });
    const d1Exam = await makePublishedExam(prisma, {
      title: `D1 ${randomUUID().slice(0, 6)}`,
      roundId: d1.id,
      demoBatchId: batch.id,
      windowStart: at(2 * HOUR),
      windowEnd: at(3 * HOUR),
    });
    const d2Exam = await makePublishedExam(prisma, {
      title: `D2 ${randomUUID().slice(0, 6)}`,
      roundId: d2.id,
      demoBatchId: batch.id,
      windowStart: at(-HOUR),
      windowEnd: at(HOUR),
    });
    const demoStudent = (n: string) =>
      student({
        email: `${n}-${randomUUID().slice(0, 6)}@demo.sirat.invalid`,
        demoBatchId: batch.id,
      });
    const without = await demoStudent('s');
    const withEntry = await demoStudent('t');
    await prisma.roundEntry.create({
      data: { userId: withEntry.id, roundId: d2.id, status: 'pending' },
    });
    await prisma.demoRecord.createMany({
      data: [
        { batchId: batch.id, tableName: 'rounds', rowId: d1.id },
        { batchId: batch.id, tableName: 'rounds', rowId: d2.id },
        { batchId: batch.id, tableName: 'exams', rowId: d1Exam.id },
        { batchId: batch.id, tableName: 'exams', rowId: d2Exam.id },
        { batchId: batch.id, tableName: 'users', rowId: without.id },
        { batchId: batch.id, tableName: 'users', rowId: withEntry.id },
      ],
    });

    const ids = await list(without.cookie);
    expect(ids).toContain(d1Exam.id); // the demo side's first round: open
    expect(ids).not.toContain(d2Exam.id);
    expect((await call(env, 'POST', `/exams/${d2Exam.id}/attempts`, without.cookie)).status).toBe(
      404,
    );
    expect((await nextExamFor(prisma, without.id))?.examId).toBe(d1Exam.id);
    expect(await list(withEntry.cookie)).toEqual(expect.arrayContaining([d1Exam.id, d2Exam.id]));
    expect((await nextExamFor(prisma, withEntry.id))?.examId).toBe(d2Exam.id);

    await prisma.$queryRaw`SELECT demo_clear(${batch.id}::uuid)`;
  });
});
