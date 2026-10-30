/**
 * Proves the database itself enforces the rules in docs/05-DATABASE.md ("Constraints that MUST exist")
 * and RULEBOOK §6/§7/§18 — not only application code. Runs against a real Postgres (*_test database).
 */
import { randomUUID } from 'node:crypto';
import { PaymentStatus, PrismaClient } from '@prisma/client';
import { seedConfig } from '../prisma/seed';
import {
  applyReferenceData,
  examData,
  makeAttempt,
  makeUser,
  paymentData,
  testPrisma,
  truncateAll,
} from './helpers';

const prisma: PrismaClient = testPrisma();

beforeAll(async () => {
  await truncateAll(prisma);
  await applyReferenceData(prisma); // Round 1 etc. come from the baseline data migration
  await seedConfig(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const UNIQUE = { code: 'P2002' };
const FOREIGN_KEY = { code: 'P2003' };

describe('exams CHECK constraints (raw SQL migration)', () => {
  it.each([0, 31, -5])('rejects duration_minutes = %i', async (durationMinutes) => {
    await expect(prisma.exam.create({ data: examData({ durationMinutes }) })).rejects.toThrow(
      /exams_duration_minutes_check/,
    );
  });

  it('accepts the 1 and 30 minute boundaries', async () => {
    await expect(
      prisma.exam.create({ data: examData({ durationMinutes: 1 }) }),
    ).resolves.toBeDefined();
    await expect(
      prisma.exam.create({ data: examData({ durationMinutes: 30 }) }),
    ).resolves.toBeDefined();
  });

  it('rejects a window that ends at or before it starts', async () => {
    const t = new Date('2026-11-01T04:00:00Z');
    await expect(
      prisma.exam.create({ data: examData({ windowStart: t, windowEnd: t }) }),
    ).rejects.toThrow(/exams_window_check/);
  });

  it('rejects questions_per_attempt = 0 and a negative grace period', async () => {
    await expect(
      prisma.exam.create({ data: examData({ questionsPerAttempt: 0 }) }),
    ).rejects.toThrow(/exams_questions_per_attempt_check/);
    await expect(prisma.exam.create({ data: examData({ graceSeconds: -1 }) })).rejects.toThrow(
      /exams_grace_seconds_check/,
    );
  });
});

describe('payments', () => {
  it('rejects a zero or negative amount', async () => {
    await expect(prisma.payment.create({ data: paymentData({ amountMinor: 0 }) })).rejects.toThrow(
      /payments_amount_minor_check/,
    );
    await expect(
      prisma.payment.create({ data: paymentData({ amountMinor: -100 }) }),
    ).rejects.toThrow(/payments_amount_minor_check/);
  });

  it('rejects status=paid without trx_id / paid_at, accepts it with both', async () => {
    await expect(
      prisma.payment.create({ data: paymentData({ status: PaymentStatus.paid }) }),
    ).rejects.toThrow(/payments_paid_has_trx_check/);
    await expect(
      prisma.payment.create({
        data: paymentData({ status: PaymentStatus.paid, trxId: `T-${randomUUID()}` }),
      }),
    ).rejects.toThrow(/payments_paid_has_trx_check/);
    await expect(
      prisma.payment.create({
        data: paymentData({
          status: PaymentStatus.paid,
          trxId: `T-${randomUUID()}`,
          paidAt: new Date(),
        }),
      }),
    ).resolves.toBeDefined();
  });

  it('never reuses an invoice_number or applies a trx_id twice', async () => {
    const invoiceNumber = `INV-${randomUUID()}`;
    await prisma.payment.create({ data: paymentData({ invoiceNumber }) });
    await expect(
      prisma.payment.create({ data: paymentData({ invoiceNumber }) }),
    ).rejects.toMatchObject(UNIQUE);

    const trxId = `TRX-${randomUUID()}`;
    await prisma.payment.create({ data: paymentData({ trxId }) });
    await expect(prisma.payment.create({ data: paymentData({ trxId }) })).rejects.toMatchObject(
      UNIQUE,
    );
  });
});

describe('one payment <-> one registration', () => {
  it('registrations are unique per user and per payment; pending registration unique per payment', async () => {
    const [u1, u2] = [await makeUser(prisma), await makeUser(prisma)];
    const p1 = await prisma.payment.create({ data: paymentData() });
    const p2 = await prisma.payment.create({ data: paymentData() });
    await prisma.registration.create({ data: { userId: u1.id, paymentId: p1.id } });

    // Same payment cannot create a second account's registration (replayed callback).
    await expect(
      prisma.registration.create({ data: { userId: u2.id, paymentId: p1.id } }),
    ).rejects.toMatchObject(UNIQUE);
    // Same user cannot hold two registrations.
    await expect(
      prisma.registration.create({ data: { userId: u1.id, paymentId: p2.id } }),
    ).rejects.toMatchObject(UNIQUE);

    await prisma.pendingRegistration.create({ data: { paymentId: p2.id, payload: {} } });
    await expect(
      prisma.pendingRegistration.create({ data: { paymentId: p2.id, payload: {} } }),
    ).rejects.toMatchObject(UNIQUE);
  });
});

describe('exam attempts and submissions', () => {
  it('allows one attempt per student per exam (timer can never be reset)', async () => {
    const user = await makeUser(prisma);
    const exam = await prisma.exam.create({ data: examData() });
    await makeAttempt(prisma, user.id, exam.id);
    await expect(makeAttempt(prisma, user.id, exam.id)).rejects.toMatchObject(UNIQUE);
  });

  it('makes the final submit idempotent by attempt_id and request_id', async () => {
    const exam = await prisma.exam.create({ data: examData() });
    const a1 = await makeAttempt(prisma, (await makeUser(prisma)).id, exam.id);
    const a2 = await makeAttempt(prisma, (await makeUser(prisma)).id, exam.id);
    const requestId = randomUUID();
    await prisma.submission.create({ data: { attemptId: a1.id, requestId, answers: {} } });

    await expect(
      prisma.submission.create({
        data: { attemptId: a1.id, requestId: randomUUID(), answers: {} },
      }),
    ).rejects.toMatchObject(UNIQUE);
    await expect(
      prisma.submission.create({ data: { attemptId: a2.id, requestId, answers: {} } }),
    ).rejects.toMatchObject(UNIQUE);
  });
});

describe('ambassador program and rounds', () => {
  it('never awards the same point event twice', async () => {
    const user = await makeUser(prisma);
    const eventKey = `referral_paid:${randomUUID()}`;
    await prisma.pointLedger.create({
      data: { userId: user.id, eventKey, amount: 10, reason: 'test' },
    });
    await expect(
      prisma.pointLedger.create({
        data: { userId: user.id, eventKey, amount: 10, reason: 'test' },
      }),
    ).rejects.toMatchObject(UNIQUE);
  });

  it('keeps one round entry per user per round (promotion never duplicates)', async () => {
    const user = await makeUser(prisma);
    const round = await prisma.round.findUniqueOrThrow({ where: { sortOrder: 1 } });
    await prisma.roundEntry.create({ data: { userId: user.id, roundId: round.id } });
    await expect(
      prisma.roundEntry.create({ data: { userId: user.id, roundId: round.id } }),
    ).rejects.toMatchObject(UNIQUE);
  });

  it('assigns a task to a user once, and promo codes / profiles are unique', async () => {
    const admin = await makeUser(prisma);
    const amb = await makeUser(prisma);
    const task = await prisma.adminTask.create({
      data: { title: 't', description: 'd', points: 5, createdById: admin.id },
    });
    await prisma.taskAssignment.create({ data: { taskId: task.id, userId: amb.id } });
    await expect(
      prisma.taskAssignment.create({ data: { taskId: task.id, userId: amb.id } }),
    ).rejects.toMatchObject(UNIQUE);

    const promoCode = `CODE-${randomUUID().slice(0, 6)}`;
    await prisma.ambassadorProfile.create({ data: { userId: amb.id, promoCode } });
    await expect(
      prisma.ambassadorProfile.create({ data: { userId: amb.id, promoCode: `${promoCode}-2` } }),
    ).rejects.toMatchObject(UNIQUE);
    await expect(
      prisma.ambassadorProfile.create({ data: { userId: (await makeUser(prisma)).id, promoCode } }),
    ).rejects.toMatchObject(UNIQUE);
  });
});

describe('identity and foreign keys', () => {
  it('treats emails case-insensitively (citext)', async () => {
    const local = `case-${randomUUID().slice(0, 8)}`;
    await makeUser(prisma, { email: `${local}@Test.invalid` });
    await expect(
      makeUser(prisma, { email: `${local.toUpperCase()}@test.INVALID` }),
    ).rejects.toMatchObject(UNIQUE);
    const found = await prisma.user.findUnique({
      where: { email: `${local.toUpperCase()}@TEST.invalid` },
    });
    expect(found).not.toBeNull();
  });

  it('rejects links to users that do not exist (no soft links)', async () => {
    const admin = await makeUser(prisma);
    await expect(
      prisma.announcement.create({ data: { title: 't', body: 'b', createdById: randomUUID() } }),
    ).rejects.toMatchObject(FOREIGN_KEY);

    const round = await prisma.round.findUniqueOrThrow({ where: { sortOrder: 1 } });
    const entry = await prisma.roundEntry.create({ data: { userId: admin.id, roundId: round.id } });
    await expect(
      prisma.juryScore.create({
        data: { entryId: entry.id, judgeId: randomUUID(), criteria: {}, total: 0 },
      }),
    ).rejects.toMatchObject(FOREIGN_KEY);
  });

  it('generates UUIDv7 primary keys', async () => {
    const user = await makeUser(prisma);
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('refuses to hard-delete a user that history points to (ON DELETE RESTRICT)', async () => {
    const owner = await makeUser(prisma);
    await prisma.payment.create({ data: paymentData({ userId: owner.id }) });
    await expect(prisma.user.delete({ where: { id: owner.id } })).rejects.toMatchObject(
      FOREIGN_KEY,
    );

    const admin = await makeUser(prisma);
    const member = await makeUser(prisma);
    await prisma.pointLedger.create({
      data: {
        userId: member.id,
        eventKey: `adj:${randomUUID()}`,
        amount: 1,
        reason: 'test',
        createdById: admin.id,
      },
    });
    await expect(prisma.user.delete({ where: { id: admin.id } })).rejects.toMatchObject(
      FOREIGN_KEY,
    );

    // Sessions are the deliberate exception: they cascade with their user.
    const plain = await makeUser(prisma);
    await prisma.session.create({
      data: {
        userId: plain.id,
        familyId: randomUUID(),
        tokenHash: randomUUID(),
        expiresAt: new Date(),
      },
    });
    await expect(prisma.user.delete({ where: { id: plain.id } })).resolves.toBeDefined();
  });

  it('treats promo codes case-insensitively (citext)', async () => {
    const code = `Code${randomUUID().slice(0, 6)}`;
    await prisma.ambassadorProfile.create({
      data: { userId: (await makeUser(prisma)).id, promoCode: code },
    });
    await expect(
      prisma.ambassadorProfile.create({
        data: { userId: (await makeUser(prisma)).id, promoCode: code.toUpperCase() },
      }),
    ).rejects.toMatchObject(UNIQUE);
  });
});

describe('schema invariants (catalog checks that guard future migrations)', () => {
  it('has an index whose leading columns cover every foreign key', async () => {
    const missing = await prisma.$queryRaw<{ tbl: string; fk: string }[]>`
      SELECT c.conrelid::regclass::text AS tbl, c.conname AS fk
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey
        )`;
    expect(missing).toEqual([]);
  });

  it('has no CHECK constraint that compares an enum to a literal (breaks Prisma enum migrations)', async () => {
    const offending = await prisma.$queryRaw<{ name: string; def: string }[]>`
      SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      WHERE c.contype = 'c' AND c.connamespace = 'public'::regnamespace
        AND EXISTS (
          SELECT 1 FROM pg_type t
          WHERE t.typtype = 'e' AND t.typnamespace = 'public'::regnamespace
            AND pg_get_constraintdef(c.oid) LIKE '%::"' || t.typname || '"%'
        )`;
    expect(offending).toEqual([]);
  });

  it('defaults updated_at in the database, so raw-SQL inserts do not need it', async () => {
    const key = `raw-${randomUUID()}`;
    await prisma.$executeRaw`INSERT INTO settings (key, value) VALUES (${key}, '1'::jsonb)`;
    const row = await prisma.setting.findUniqueOrThrow({ where: { key } });
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it('gives every new session the app-wide statement, lock and idle-transaction timeouts', async () => {
    const [row] = await prisma.$queryRaw<{ statement: string; lock: string; idle: string }[]>`
      SELECT current_setting('statement_timeout') AS statement,
             current_setting('lock_timeout') AS lock,
             current_setting('idle_in_transaction_session_timeout') AS idle`;
    expect(row).toEqual({ statement: '10s', lock: '5s', idle: '1min' });
  });
});
