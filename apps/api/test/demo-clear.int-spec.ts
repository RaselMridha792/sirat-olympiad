/**
 * The demo registry and its one delete path (DECISIONS 2026-11-08 "Demo data, loaded and removed with one click";
 * migration *_demo_data_clear). demo_clear(batch) removes exactly what a batch made, children first; a row goes only
 * through a root (user, exam, announcement) that is registered for the batch AND marked with it, and the guarded tables
 * let a DELETE through only inside demo_clear and only for such a root. A forged registry row, the setting turned on by
 * hand, or both, never delete a real attempt, submission, question or answer-key correction. The direct deletes as
 * sirat_app run when TEST_APP_DATABASE_URL is set (CI always sets it).
 */
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { makeAttempt, makePublishedExam, questionData, submissionData } from './exam-helpers';
import { makeUser, testPrisma } from './helpers';

const prisma = testPrisma();
const appUrl = process.env.TEST_APP_DATABASE_URL ?? '';
const DOMAIN = '@demo.sirat.invalid';

afterEach(async () => {
  // One batch at a time (a unique index): every test leaves none behind, even one that failed half-way. Marked roots it
  // did not register are registered here first, so demo_clear can take them.
  for (const { id } of await prisma.demoBatch.findMany({ select: { id: true } })) {
    const roots = [
      ['users', await prisma.user.findMany({ where: { demoBatchId: id }, select: { id: true } })],
      ['exams', await prisma.exam.findMany({ where: { demoBatchId: id }, select: { id: true } })],
      [
        'announcements',
        await prisma.announcement.findMany({ where: { demoBatchId: id }, select: { id: true } }),
      ],
    ] as const;
    for (const [table, rows] of roots)
      await prisma.demoRecord.createMany({
        data: rows.map((r) => ({ batchId: id, tableName: table, rowId: r.id })),
        skipDuplicates: true,
      });
    await prisma.$executeRawUnsafe('TRUNCATE "point_ledger"');
    await prisma.$queryRaw`SELECT demo_clear(${id}::uuid)`;
  }
});
afterAll(async () => {
  await prisma.$disconnect();
});

const register = (batchId: string, table: string, ids: string[]) =>
  prisma.demoRecord.createMany({
    data: ids.map((rowId) => ({ batchId, tableName: table, rowId })),
  });

const clear = async (batchId: string) => {
  const [row] = await prisma.$queryRaw<{ counts: Record<string, number> }[]>`
    SELECT demo_clear(${batchId}::uuid) AS counts`;
  return row!.counts;
};

/** A batch with one demo student, a published demo exam and a scored-looking attempt with its submission. */
async function demoGraph() {
  const batch = await prisma.demoBatch.create({ data: { status: 'loaded', reason: 'Test batch' } });
  const user = await makeUser(prisma, {
    email: `s-${randomUUID().slice(0, 8)}${DOMAIN}`,
    role: 'student',
    demoBatchId: batch.id,
  });
  const exam = await makePublishedExam(prisma, { title: 'DEMO · Round 1', demoBatchId: batch.id });
  const question = await prisma.question.create({ data: questionData(exam.id) });
  const attempt = await makeAttempt(prisma, user.id, exam.id);
  const submission = await prisma.submission.create({ data: submissionData(attempt.id) });
  const note = await prisma.announcement.create({
    data: {
      title: 'Demo note',
      body: 'A demo announcement',
      createdById: (await anAdmin()).id,
      demoBatchId: batch.id,
    },
  });
  await register(batch.id, 'users', [user.id]);
  await register(batch.id, 'exams', [exam.id]);
  await register(batch.id, 'questions', [question.id]);
  await register(batch.id, 'attempts', [attempt.id]);
  await register(batch.id, 'submissions', [submission.id]);
  await register(batch.id, 'announcements', [note.id]);
  return { batch, user, exam, question, attempt, submission, note };
}

let admin: { id: string } | null = null;
async function anAdmin() {
  admin ??= await makeUser(prisma, { role: 'admin' });
  return admin;
}

/** A real student's attempt and submission on a real published exam (no marker, not registered). */
async function realGraph() {
  const user = await makeUser(prisma, { role: 'student' });
  const exam = await makePublishedExam(prisma);
  const question = await prisma.question.create({ data: questionData(exam.id) });
  const attempt = await makeAttempt(prisma, user.id, exam.id);
  const submission = await prisma.submission.create({ data: submissionData(attempt.id) });
  return { user, exam, question, attempt, submission };
}

async function stillThere(real: Awaited<ReturnType<typeof realGraph>>) {
  expect(await prisma.user.count({ where: { id: real.user.id } })).toBe(1);
  expect(await prisma.exam.count({ where: { id: real.exam.id } })).toBe(1);
  expect(await prisma.question.count({ where: { id: real.question.id } })).toBe(1);
  expect(await prisma.attempt.count({ where: { id: real.attempt.id } })).toBe(1);
  expect(await prisma.submission.count({ where: { id: real.submission.id } })).toBe(1);
}

describe('demo_clear', () => {
  it('removes everything a batch made, children first, also rows made after the load; nothing real; idempotent', async () => {
    const real = await realGraph();
    const demo = await demoGraph();
    // After the load: the demo student signs in and tries a REAL exam; a real student tries the DEMO exam.
    await prisma.session.create({
      data: {
        userId: demo.user.id,
        tokenHash: randomUUID(),
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const demoOnReal = await makeAttempt(prisma, demo.user.id, real.exam.id);
    const realOnDemo = await makeAttempt(prisma, real.user.id, demo.exam.id);
    await prisma.submission.create({ data: submissionData(realOnDemo.id) });

    const counts = await clear(demo.batch.id);
    expect(counts).toMatchObject({
      attempts: 3, // the demo one, the demo student's on the real exam, the real student's on the demo exam
      submissions: 2,
      questions: 1,
      exams: 1,
      announcements: 1,
      users: 1,
    });
    expect(await prisma.user.count({ where: { id: demo.user.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: demo.user.id } })).toBe(0); // cascade
    expect(await prisma.exam.count({ where: { id: demo.exam.id } })).toBe(0);
    expect(
      await prisma.attempt.count({ where: { id: { in: [demoOnReal.id, realOnDemo.id] } } }),
    ).toBe(0);
    expect(await prisma.demoRecord.count({ where: { batchId: demo.batch.id } })).toBe(0);
    expect(await prisma.demoBatch.count({ where: { id: demo.batch.id } })).toBe(0);
    await stillThere(real);
    expect(await clear(demo.batch.id)).toEqual({}); // idempotent: nothing left, no error
  });

  it('never deletes a real row through a forged registry entry', async () => {
    const real = await realGraph();
    const demo = await demoGraph();
    // Forged: the real rows registered under the demo batch.
    await register(demo.batch.id, 'users', [real.user.id]);
    await register(demo.batch.id, 'exams', [real.exam.id]);
    await register(demo.batch.id, 'attempts', [real.attempt.id]);
    await register(demo.batch.id, 'submissions', [real.submission.id]);
    await clear(demo.batch.id);
    await stillThere(real);
  });

  it('needs the registry AND the marker: a marked but unregistered user stays, and so do their attempts', async () => {
    const batch = await prisma.demoBatch.create({
      data: { status: 'loaded', reason: 'Test batch' },
    });
    const user = await makeUser(prisma, {
      email: `u-${randomUUID().slice(0, 8)}${DOMAIN}`,
      role: 'student',
      demoBatchId: batch.id,
    });
    const exam = await makePublishedExam(prisma);
    const attempt = await makeAttempt(prisma, user.id, exam.id);
    // demo_clear refuses to leave the batch half-removed: the user still holds it (FK), so the call fails as a whole.
    await expect(clear(batch.id)).rejects.toThrow(/users_demo_batch_id_fkey|violates foreign key/);
    expect(await prisma.attempt.count({ where: { id: attempt.id } })).toBe(1);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
    // Clean up for afterEach: register the user, then the batch clears.
    await register(batch.id, 'users', [user.id]);
  });

  it('rolls back as a whole when a demo user has rows it does not clear yet (point_ledger)', async () => {
    const demo = await demoGraph();
    await prisma.pointLedger.create({
      data: {
        userId: demo.user.id,
        eventKey: `test:${randomUUID()}`,
        amount: 5,
        createdById: (await anAdmin()).id,
        reason: 'A test adjustment',
      },
    });
    await expect(clear(demo.batch.id)).rejects.toThrow();
    expect(await prisma.attempt.count({ where: { id: demo.attempt.id } })).toBe(1);
    expect(await prisma.demoBatch.count({ where: { id: demo.batch.id } })).toBe(1);
    // The ledger row is append-only, so this batch can only go with TRUNCATE here: leave the next test a clean table.
    await prisma.$executeRawUnsafe('TRUNCATE "point_ledger"');
  });
});

describe('the guarded tables outside demo_clear', () => {
  it('refuse a delete of a real row with the setting on and a forged registry row (as the owner)', async () => {
    const real = await realGraph();
    const demo = await demoGraph();
    await register(demo.batch.id, 'attempts', [real.attempt.id]);
    await register(demo.batch.id, 'exams', [real.exam.id]);
    const tryDelete = (sql: Prisma.Sql) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('sirat.demo_clear', 'on', true)`;
        await tx.$executeRaw(sql);
      });
    await expect(
      tryDelete(Prisma.sql`DELETE FROM "submissions" WHERE "id" = ${real.submission.id}::uuid`),
    ).rejects.toThrow(/append-only/);
    await expect(
      tryDelete(Prisma.sql`DELETE FROM "attempts" WHERE "id" = ${real.attempt.id}::uuid`),
    ).rejects.toThrow(/attempts are never deleted/);
    await expect(
      tryDelete(Prisma.sql`DELETE FROM "questions" WHERE "id" = ${real.question.id}::uuid`),
    ).rejects.toThrow(/questions_frozen_after_publish/);
    await stillThere(real);
  });

  it('refuse a delete of a DEMO row outside demo_clear (the setting off)', async () => {
    const demo = await demoGraph();
    await expect(
      prisma.$executeRaw`DELETE FROM "submissions" WHERE "id" = ${demo.submission.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRaw`DELETE FROM "attempts" WHERE "id" = ${demo.attempt.id}::uuid`,
    ).rejects.toThrow(/never deleted/);
  });
});

describe('the roots', () => {
  it('keep the marker domain for demo accounts only, and never make a demo admin or manager', async () => {
    await expect(
      makeUser(prisma, { email: `real-${randomUUID().slice(0, 8)}${DOMAIN}` }),
    ).rejects.toThrow(/users_demo_email_check/);
    const batch = await prisma.demoBatch.create({
      data: { status: 'loaded', reason: 'Test batch' },
    });
    await expect(makeUser(prisma, { demoBatchId: batch.id })).rejects.toThrow(
      /users_demo_email_check/,
    );
    await expect(
      makeUser(prisma, {
        email: `a-${randomUUID().slice(0, 8)}${DOMAIN}`,
        role: 'admin',
        demoBatchId: batch.id,
      }),
    ).rejects.toThrow(/users_demo_role_check/);
    // Other .invalid domains (CI and the fixtures) stay valid.
    await expect(
      makeUser(prisma, { email: `ok-${randomUUID().slice(0, 8)}@fixtures.invalid` }),
    ).resolves.toBeTruthy();
  });

  it('never change their marker: a real row cannot become demo, a demo row cannot stop being one', async () => {
    const batch = await prisma.demoBatch.create({
      data: { status: 'loaded', reason: 'Test batch' },
    });
    const real = await makeUser(prisma);
    await expect(
      prisma.user.update({ where: { id: real.id }, data: { demoBatchId: batch.id } }),
    ).rejects.toThrow(/demo_marker_immutable/);
    const exam = await makePublishedExam(prisma);
    await expect(
      prisma.exam.update({ where: { id: exam.id }, data: { demoBatchId: batch.id } }),
    ).rejects.toThrow(/demo_marker_immutable/);
    const demoExam = await makePublishedExam(prisma, { demoBatchId: batch.id });
    await register(batch.id, 'exams', [demoExam.id]);
    await expect(
      prisma.exam.update({ where: { id: demoExam.id }, data: { demoBatchId: null } }),
    ).rejects.toThrow(/demo_marker_immutable/);
  });

  it('allow one batch at a time', async () => {
    await prisma.demoBatch.create({ data: { status: 'loaded', reason: 'Test batch' } });
    await expect(
      prisma.demoBatch.create({ data: { status: 'loading', reason: 'Second' } }),
    ).rejects.toThrow(/demo_batches_one_at_a_time|Unique constraint/);
  });
});

describe('who may call demo_clear', () => {
  it('only sirat_app (and the owner): PUBLIC has no EXECUTE', async () => {
    const [row] = await prisma.$queryRaw<{ acl: string | null }[]>`
      SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'demo_clear'`;
    expect(row!.acl ?? '').not.toMatch(/(^|[{,])=X/); // no "=X/owner" entry: PUBLIC cannot execute
  });

  (appUrl ? describe : describe.skip)('connected as sirat_app', () => {
    const app = new PrismaClient({
      datasourceUrl: appUrl || 'postgresql://unused@127.0.0.1/unused_test',
    });
    afterAll(async () => {
      await app.$disconnect();
    });

    it('may call it, and may not delete a real submission or attempt directly, even with the setting on', async () => {
      const real = await realGraph();
      const demo = await demoGraph();
      await register(demo.batch.id, 'attempts', [real.attempt.id]);
      const asApp = (sql: Prisma.Sql) =>
        app.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('sirat.demo_clear', 'on', true)`;
          await tx.$executeRaw(sql);
        });
      await expect(
        asApp(Prisma.sql`DELETE FROM "submissions" WHERE "id" = ${real.submission.id}::uuid`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asApp(Prisma.sql`DELETE FROM "attempts" WHERE "id" = ${real.attempt.id}::uuid`),
      ).rejects.toThrow(/never deleted/);
      await expect(
        asApp(Prisma.sql`DELETE FROM "demo_records" WHERE "batch_id" = ${demo.batch.id}::uuid`),
      ).rejects.toThrow(/permission denied/);
      const [row] = await app.$queryRaw<{ counts: Record<string, number> }[]>`
        SELECT demo_clear(${demo.batch.id}::uuid) AS counts`;
      expect(row!.counts).toMatchObject({ users: 1, exams: 1 });
      await stillThere(real);
    });
  });
});
