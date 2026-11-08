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
  // One batch at a time (a unique index): every test leaves none behind, even one that failed half-way.
  const batches = await prisma.demoBatch.findMany({ select: { id: true } });
  if (batches.length === 0) return;
  // The mixes some tests make on purpose cannot be deleted row by row (a real attempt is never deleted), so this *_test
  // database drops them by TRUNCATE (allowed here only), and a real row's pointer at a demo user is unset.
  await prisma.$executeRawUnsafe(
    'TRUNCATE "attempts", "jury_scores", "point_ledger", "team_members" CASCADE',
  );
  await prisma.$executeRaw`
    UPDATE "users" SET "referred_by_id" = NULL
    WHERE "referred_by_id" IN (SELECT "id" FROM "users" WHERE "demo_batch_id" IS NOT NULL)`;
  for (const { id } of batches) {
    // Marked roots a test did not register are registered first, so demo_clear can take them.
    await prisma.demoBatch.update({ where: { id }, data: { status: 'loaded' } });
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

/** A demo or real round entry on a final round made for the test, with a promotion run from `examId`. */
async function roundSetup() {
  const from =
    (await prisma.round.findFirst({ where: { sortOrder: 1 } })) ??
    (await prisma.round.create({
      data: { name: 'Round 1', sortOrder: 1, type: 'quiz' },
    }));
  const to =
    (await prisma.round.findFirst({ where: { sortOrder: 10 } })) ??
    (await prisma.round.create({
      data: { name: 'Demo test final', sortOrder: 10, type: 'final' },
    }));
  return { from, to };
}

async function blockedWith(batchId: string, kind: string) {
  await expect(clear(batchId)).rejects.toThrow(new RegExp(`demo_clear_blocked: .*"${kind}": 1`));
}

describe('demo_clear', () => {
  it('removes everything a batch made, children first, also what a demo account made after the load; nothing real; idempotent', async () => {
    const real = await realGraph();
    const demo = await demoGraph();
    // After the load, the demo student signs in and tries the demo practice exam.
    await prisma.session.create({
      data: {
        userId: demo.user.id,
        tokenHash: randomUUID(),
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const practice = await makePublishedExam(prisma, {
      title: 'DEMO · Practice',
      demoBatchId: demo.batch.id,
    });
    await register(demo.batch.id, 'exams', [practice.id]);
    const own = await makeAttempt(prisma, demo.user.id, practice.id);
    await prisma.submission.create({ data: submissionData(own.id) });

    const counts = await clear(demo.batch.id);
    expect(counts).toMatchObject({
      attempts: 2,
      submissions: 2,
      questions: 1,
      exams: 2,
      announcements: 1,
      users: 1,
    });
    expect(await prisma.user.count({ where: { id: demo.user.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: demo.user.id } })).toBe(0); // cascade
    expect(await prisma.exam.count({ where: { id: { in: [demo.exam.id, practice.id] } } })).toBe(0);
    expect(await prisma.demoRecord.count({ where: { batchId: demo.batch.id } })).toBe(0);
    expect(await prisma.demoBatch.count({ where: { id: demo.batch.id } })).toBe(0);
    await stillThere(real);
    expect(await clear(demo.batch.id)).toEqual({}); // idempotent: nothing left, no error
  });

  it("clears a demo ambassador's points, a demo jury's scores and a promotion run from the demo exam", async () => {
    const demo = await demoGraph();
    const judge = await makeUser(prisma, {
      email: `j-${randomUUID().slice(0, 8)}${DOMAIN}`,
      role: 'jury',
      demoBatchId: demo.batch.id,
    });
    await register(demo.batch.id, 'users', [judge.id]);
    await prisma.pointLedger.create({
      data: {
        userId: demo.user.id,
        eventKey: `test:${randomUUID()}`,
        amount: 5,
        createdById: (await anAdmin()).id,
        reason: 'A test adjustment',
      },
    });
    const { from, to } = await roundSetup();
    const run = await prisma.promotionRun.create({
      data: {
        fromRoundId: from.id,
        toRoundId: to.id,
        category: 'achiever',
        topN: 1,
        sourceKind: 'exam',
        sourceExamId: demo.exam.id,
        sourceGeneration: 1,
        promotedCount: 1,
        eliminatedCount: 0,
        createdById: (await anAdmin()).id,
      },
    });
    const entry = await prisma.roundEntry.create({
      data: { userId: demo.user.id, roundId: to.id, promotionRunId: run.id },
    });
    await prisma.juryScore.create({
      data: { entryId: entry.id, judgeId: judge.id, total: 70, criteria: { idea: 70 } },
    });

    const counts = await clear(demo.batch.id);
    expect(counts).toMatchObject({
      point_ledger: 1,
      jury_scores: 1,
      round_entries: 1,
      promotion_runs: 1,
      users: 2,
    });
    expect(await prisma.promotionRun.count({ where: { id: run.id } })).toBe(0);
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

  it('needs the registry AND the marker: a marked but unregistered user stays, and the call fails as a whole', async () => {
    const batch = await prisma.demoBatch.create({
      data: { status: 'loaded', reason: 'Test batch' },
    });
    const user = await makeUser(prisma, {
      email: `u-${randomUUID().slice(0, 8)}${DOMAIN}`,
      role: 'student',
      demoBatchId: batch.id,
    });
    await expect(clear(batch.id)).rejects.toThrow(/users_demo_batch_id_fkey|violates foreign key/);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
  });

  it('refuses while the batch is still loading (demo_clear_busy), and deletes nothing', async () => {
    const demo = await demoGraph();
    await prisma.demoBatch.update({ where: { id: demo.batch.id }, data: { status: 'loading' } });
    await expect(clear(demo.batch.id)).rejects.toThrow(/demo_clear_busy/);
    expect(await prisma.attempt.count({ where: { id: demo.attempt.id } })).toBe(1);
    await prisma.demoBatch.update({ where: { id: demo.batch.id }, data: { status: 'loaded' } });
  });
});

describe('demo_clear refuses a mix of demo and real rows (demo_clear_blocked), and deletes nothing', () => {
  it("a real student's attempt on a demo exam", async () => {
    const real = await realGraph();
    const demo = await demoGraph();
    await makeAttempt(prisma, real.user.id, demo.exam.id);
    await blockedWith(demo.batch.id, 'real_attempts_on_demo_exams');
    expect(await prisma.attempt.count({ where: { id: demo.attempt.id } })).toBe(1);
    expect(await prisma.demoBatch.count({ where: { id: demo.batch.id } })).toBe(1);
  });

  it("a demo student's attempt on a real exam", async () => {
    const real = await realGraph();
    const demo = await demoGraph();
    await makeAttempt(prisma, demo.user.id, real.exam.id);
    await blockedWith(demo.batch.id, 'demo_attempts_on_real_exams');
  });

  it('a real student referred by a demo account', async () => {
    const demo = await demoGraph();
    await makeUser(prisma, { referredById: demo.user.id });
    await blockedWith(demo.batch.id, 'real_users_referred_by_demo');
  });

  it("a demo judge's score on a real entry", async () => {
    const demo = await demoGraph();
    const realStudent = await makeUser(prisma, { role: 'student' });
    const { to } = await roundSetup();
    const entry = await prisma.roundEntry.create({
      data: { userId: realStudent.id, roundId: to.id },
    });
    const judge = await makeUser(prisma, {
      email: `j-${randomUUID().slice(0, 8)}${DOMAIN}`,
      role: 'jury',
      demoBatchId: demo.batch.id,
    });
    await register(demo.batch.id, 'users', [judge.id]);
    await prisma.juryScore.create({
      data: { entryId: entry.id, judgeId: judge.id, total: 50, criteria: {} },
    });
    await blockedWith(demo.batch.id, 'mixed_jury_scores');
  });

  it('a real member in a demo-owned team', async () => {
    const demo = await demoGraph();
    const team = await prisma.team.create({
      data: {
        name: `Demo team ${randomUUID().slice(0, 6)}`,
        joinCode: `TM-${Array.from({ length: 6 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('')}`,
        ownerId: demo.user.id,
      },
    });
    const realStudent = await makeUser(prisma, { role: 'student' });
    await prisma.teamMember.create({ data: { teamId: team.id, userId: realStudent.id } });
    await blockedWith(demo.batch.id, 'mixed_team_members');
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
