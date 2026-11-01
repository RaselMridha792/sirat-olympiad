/**
 * Proves the database itself enforces the rules in docs/05-DATABASE.md ("Constraints that MUST exist")
 * and RULEBOOK §6/§7/§18 — not only application code. Runs against a real Postgres (*_test database).
 */
import { randomUUID } from 'node:crypto';
import { PaymentStatus, PrismaClient, RegistrationAttemptStatus } from '@prisma/client';
import { seedConfig } from '../prisma/seed';
import {
  applyReferenceData,
  examData,
  makePaidPayment,
  makeRegistrationAttempt,
  makeUser,
  paymentData,
  testInvoice,
  testPhone,
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

/** A payment of a fresh attempt, moved along legal transitions to `status`. */
async function paymentIn(status: 'initiated' | 'pending' | 'failed' | 'expired') {
  const attempt = await makeRegistrationAttempt(prisma);
  const payment = await prisma.payment.create({ data: paymentData(attempt.id) });
  if (status === 'initiated') return payment;
  await prisma.payment.update({ where: { id: payment.id }, data: { status: 'pending' } });
  if (status === 'pending') return payment;
  return prisma.payment.update({ where: { id: payment.id }, data: { status } });
}
const paidFields = (amountMinor = 40000) => ({
  status: PaymentStatus.paid,
  trxId: `TRX${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
  paidAmountMinor: amountMinor,
  paidAt: new Date(),
});

describe('payments (raw SQL CHECKs)', () => {
  it('rejects a zero or negative amount', async () => {
    const attempt = await makeRegistrationAttempt(prisma);
    for (const amountMinor of [0, -100]) {
      await expect(
        prisma.payment.create({ data: paymentData(attempt.id, { amountMinor }) }),
      ).rejects.toThrow(/payments_amount_minor_check/);
    }
  });

  it('rejects an amount that is not whole taka, and any currency but BDT', async () => {
    const attempt = await makeRegistrationAttempt(prisma);
    await expect(
      prisma.payment.create({ data: paymentData(attempt.id, { amountMinor: 40050 }) }),
    ).rejects.toThrow(/payments_amount_whole_taka_check/);
    await expect(
      prisma.payment.create({ data: paymentData(attempt.id, { currency: 'USD' }) }),
    ).rejects.toThrow(/payments_currency_check/);
  });

  it('rejects invoice numbers outside ^[A-Z0-9]{10,20}$, an empty trx_id and a bad account label', async () => {
    const attempt = await makeRegistrationAttempt(prisma);
    for (const invoiceNumber of [
      'INV-12345678',
      't1234567890',
      'T12345678',
      `T${'1'.repeat(20)}`,
    ]) {
      await expect(
        prisma.payment.create({ data: paymentData(attempt.id, { invoiceNumber }) }),
      ).rejects.toThrow(/payments_invoice_number_check/);
    }
    await expect(
      prisma.payment.create({ data: paymentData(attempt.id, { trxId: '' }) }),
    ).rejects.toThrow(/payments_trx_id_check/);
    await expect(
      prisma.payment.create({ data: paymentData(attempt.id, { gatewayAccount: 'Rasel Sandbox' }) }),
    ).rejects.toThrow(/payments_gateway_account_check/);
  });

  it('paid needs trx_id, paid_at and exactly the amount PayStation had to report', async () => {
    const pending = await paymentIn('pending');
    const { trxId, paidAt } = paidFields();
    await expect(
      prisma.payment.update({
        where: { id: pending.id },
        data: { status: PaymentStatus.paid, paidAmountMinor: 40000 },
      }),
    ).rejects.toThrow(/payments_paid_has_trx_check/);
    for (const paidAmountMinor of [39900, 40100, null]) {
      await expect(
        prisma.payment.update({
          where: { id: pending.id },
          data: { status: PaymentStatus.paid, trxId, paidAt, paidAmountMinor },
        }),
      ).rejects.toThrow(/payments_paid_amount_check/);
    }
    await expect(
      prisma.payment.update({ where: { id: pending.id }, data: paidFields() }),
    ).resolves.toMatchObject({ status: PaymentStatus.paid });
  });

  it('never reuses an invoice_number or applies a trx_id twice', async () => {
    const attempt = await makeRegistrationAttempt(prisma);
    const invoiceNumber = testInvoice();
    await prisma.payment.create({ data: paymentData(attempt.id, { invoiceNumber }) });
    await prisma.payment.update({
      where: { invoiceNumber },
      data: { status: PaymentStatus.failed },
    });
    await expect(
      prisma.payment.create({ data: paymentData(attempt.id, { invoiceNumber }) }),
    ).rejects.toMatchObject(UNIQUE);

    const trxId = `TRX${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    const first = await makeRegistrationAttempt(prisma);
    const second = await makeRegistrationAttempt(prisma);
    await prisma.payment.create({ data: paymentData(first.id, { trxId }) });
    await expect(
      prisma.payment.create({ data: paymentData(second.id, { trxId }) }),
    ).rejects.toMatchObject(UNIQUE);
  });

  it('allows one active (initiated/pending) payment per attempt; a new one after the last is final', async () => {
    const attempt = await makeRegistrationAttempt(prisma);
    const first = await prisma.payment.create({ data: paymentData(attempt.id) });
    await expect(prisma.payment.create({ data: paymentData(attempt.id) })).rejects.toMatchObject(
      UNIQUE,
    );
    await prisma.payment.update({ where: { id: first.id }, data: { status: 'pending' } });
    await expect(prisma.payment.create({ data: paymentData(attempt.id) })).rejects.toMatchObject(
      UNIQUE,
    );
    await prisma.payment.update({ where: { id: first.id }, data: { status: 'failed' } });
    await expect(prisma.payment.create({ data: paymentData(attempt.id) })).resolves.toBeDefined();
  });
});

describe('payment status transitions (trigger)', () => {
  it('refuses a new payment in any status but initiated', async () => {
    const attempt = await makeRegistrationAttempt(prisma);
    for (const status of [PaymentStatus.pending, PaymentStatus.paid, PaymentStatus.refunded]) {
      await expect(
        prisma.payment.create({
          data: paymentData(attempt.id, { status, ...(status === 'paid' ? paidFields() : {}) }),
        }),
      ).rejects.toThrow(/a new payment must start as initiated/);
    }
  });

  it('allows exactly the transitions of the state machine', async () => {
    const allowed: [Parameters<typeof paymentIn>[0], PaymentStatus][] = [
      ['initiated', PaymentStatus.pending],
      ['initiated', PaymentStatus.failed],
      ['pending', PaymentStatus.failed],
      ['pending', PaymentStatus.expired],
    ];
    for (const [from, to] of allowed) {
      const p = await paymentIn(from);
      await expect(
        prisma.payment.update({ where: { id: p.id }, data: { status: to } }),
      ).resolves.toMatchObject({ status: to });
    }
    // Money taken wins: pending, failed and expired can all become paid (late success, admin reconcile).
    for (const from of ['pending', 'failed', 'expired'] as const) {
      const p = await paymentIn(from);
      await expect(
        prisma.payment.update({ where: { id: p.id }, data: paidFields() }),
      ).resolves.toMatchObject({ status: PaymentStatus.paid });
    }
  });

  it('refuses every other transition: a stale failure never downgrades paid, nothing reaches refunded', async () => {
    const paid = await makePaidPayment(prisma);
    for (const to of [
      PaymentStatus.failed,
      PaymentStatus.expired,
      PaymentStatus.pending,
      PaymentStatus.initiated,
      PaymentStatus.refunded,
    ]) {
      await expect(
        prisma.payment.update({ where: { id: paid.id }, data: { status: to } }),
      ).rejects.toThrow(/status paid -> \w+ is not allowed/);
    }
    const refused: [Parameters<typeof paymentIn>[0], PaymentStatus][] = [
      ['initiated', PaymentStatus.paid],
      ['initiated', PaymentStatus.expired],
      ['pending', PaymentStatus.initiated],
      ['pending', PaymentStatus.refunded],
      ['failed', PaymentStatus.pending],
      ['failed', PaymentStatus.expired],
      ['expired', PaymentStatus.failed],
    ];
    for (const [from, to] of refused) {
      const p = await paymentIn(from);
      await expect(
        prisma.payment.update({
          where: { id: p.id },
          data: { status: to, ...(to === 'paid' ? paidFields() : {}) },
        }),
      ).rejects.toThrow(/is not allowed/);
    }
  });
});

describe('one payment <-> one registration', () => {
  it('registrations are unique per user and per payment', async () => {
    const [u1, u2] = [await makeUser(prisma), await makeUser(prisma)];
    const p1 = await makePaidPayment(prisma, u1.id);
    await prisma.registration.create({ data: { userId: u1.id, paymentId: p1.id } });

    // Same payment cannot create a second account's registration (replayed callback): the trigger refuses another
    // user's payment, and the UNIQUE index stands behind it.
    await expect(
      prisma.registration.create({ data: { userId: u2.id, paymentId: p1.id } }),
    ).rejects.toThrow(/payment must be paid and belong to the same user/);
    // Same user cannot hold two registrations.
    const p2 = await makePaidPayment(prisma, u1.id);
    await expect(
      prisma.registration.create({ data: { userId: u1.id, paymentId: p2.id } }),
    ).rejects.toMatchObject(UNIQUE);
  });

  it('a registration needs a paid payment of the same user (trigger)', async () => {
    const user = await makeUser(prisma);
    const pending = await paymentIn('pending');
    await prisma.payment.update({ where: { id: pending.id }, data: { userId: user.id } });
    await expect(
      prisma.registration.create({ data: { userId: user.id, paymentId: pending.id } }),
    ).rejects.toThrow(/payment must be paid and belong to the same user/);

    const someoneElses = await makePaidPayment(prisma, (await makeUser(prisma)).id);
    await expect(
      prisma.registration.create({ data: { userId: user.id, paymentId: someoneElses.id } }),
    ).rejects.toThrow(/payment must be paid and belong to the same user/);

    const ownerless = await makePaidPayment(prisma, null);
    await expect(
      prisma.registration.create({ data: { userId: user.id, paymentId: ownerless.id } }),
    ).rejects.toThrow(/payment must be paid and belong to the same user/);

    const own = await makePaidPayment(prisma, user.id);
    await expect(
      prisma.registration.create({ data: { userId: user.id, paymentId: own.id } }),
    ).resolves.toBeDefined();
  });
});

describe('registration attempts and phone numbers (owner: one number, one student)', () => {
  it('stores phones only as 01XXXXXXXXX, on users and on attempts', async () => {
    for (const phone of [
      '+8801712345678',
      '8801712345678',
      '01212345678',
      '0171234567',
      '017-1234-5678',
    ]) {
      await expect(makeUser(prisma, { phone })).rejects.toThrow(/users_phone_check/);
      await expect(makeRegistrationAttempt(prisma, { phone })).rejects.toThrow(
        /pending_registrations_phone_check/,
      );
    }
  });

  it('users.phone is unique, but any number of users may have no phone (CLI admins)', async () => {
    const phone = testPhone();
    await makeUser(prisma, { phone });
    await expect(makeUser(prisma, { phone })).rejects.toMatchObject(UNIQUE);
    await makeUser(prisma, { phone: null });
    await expect(makeUser(prisma, { phone: null })).resolves.toBeDefined();
  });

  it('allows one open attempt per email and per phone; finished attempts do not block a new one', async () => {
    const email = `open-${randomUUID().slice(0, 8)}@test.invalid`;
    const phone = testPhone();
    const first = await makeRegistrationAttempt(prisma, { email, phone });
    await expect(
      makeRegistrationAttempt(prisma, { email: email.toUpperCase() }),
    ).rejects.toMatchObject(UNIQUE);
    await expect(makeRegistrationAttempt(prisma, { phone })).rejects.toMatchObject(UNIQUE);

    await prisma.pendingRegistration.update({
      where: { id: first.id },
      data: { status: RegistrationAttemptStatus.abandoned },
    });
    await expect(makeRegistrationAttempt(prisma, { email, phone })).resolves.toBeDefined();
  });

  it('completed exactly when the account and the completion time are set', async () => {
    const user = await makeUser(prisma);
    await expect(
      makeRegistrationAttempt(prisma, { status: RegistrationAttemptStatus.completed }),
    ).rejects.toThrow(/pending_registrations_completed_check/);
    await expect(
      makeRegistrationAttempt(prisma, { userId: user.id, completedAt: new Date() }),
    ).rejects.toThrow(/pending_registrations_completed_check/);
    await expect(
      makeRegistrationAttempt(prisma, {
        status: RegistrationAttemptStatus.completed,
        userId: user.id,
        completedAt: new Date(),
      }),
    ).resolves.toBeDefined();
  });
});

describe('payment_events is append-only (trigger)', () => {
  it('accepts inserts with a known source; refuses UPDATE, DELETE and TRUNCATE', async () => {
    const paymentId = randomUUID(); // not a foreign key: unknown invoices are logged too
    const row = await prisma.paymentEvent.create({
      data: { paymentId, source: 'ipn', outcome: 'unknown_invoice', payload: { a: 1 } },
    });
    await expect(
      prisma.paymentEvent.create({ data: { source: 'browser', outcome: 'applied_paid' } }),
    ).rejects.toThrow(/payment_events_source_check/);
    await expect(
      prisma.paymentEvent.create({ data: { source: 'ipn', outcome: 'Applied Paid' } }),
    ).rejects.toThrow(/payment_events_outcome_check/);
    await expect(
      prisma.paymentEvent.create({
        data: { source: 'ipn', outcome: 'no_change', payload: { big: 'x'.repeat(17_000) } },
      }),
    ).rejects.toThrow(/payment_events_payload_size_check/);

    await expect(
      prisma.paymentEvent.update({ where: { id: row.id }, data: { outcome: 'applied_paid' } }),
    ).rejects.toThrow(/append-only: UPDATE/);
    await expect(prisma.paymentEvent.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only: DELETE/,
    );
    await expect(prisma.$executeRawUnsafe('TRUNCATE payment_events')).rejects.toThrow(
      /append-only: TRUNCATE/,
    );
    expect(await prisma.paymentEvent.count({ where: { paymentId } })).toBe(1);
  });
});

describe('settings: the registration fee (CHECK)', () => {
  it('accepts a positive whole-taka fee in paisa and refuses anything else', async () => {
    const where = { key: 'registration_fee_minor' };
    for (const value of [0, -40000, 40050, 400.5, '40000', true]) {
      await expect(prisma.setting.update({ where, data: { value } })).rejects.toThrow(
        /settings_registration_fee_check/,
      );
    }
    await expect(prisma.setting.update({ where, data: { value: 50000 } })).resolves.toBeDefined();
    await prisma.setting.update({ where, data: { value: 40000 } });
    // Other keys are not touched by this CHECK.
    await expect(
      prisma.setting.update({ where: { key: 'payment_expiry_minutes' }, data: { value: 0 } }),
    ).resolves.toBeDefined();
    await prisma.setting.update({ where: { key: 'payment_expiry_minutes' }, data: { value: 10 } });
  });
});

// Exam attempts and submissions (one attempt per student, idempotent submit, the exam engine's CHECKs and
// triggers): test/exam-constraints.int-spec.ts.

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
      prisma.announcement.create({
        data: { title: 'Title', body: 'b', createdById: randomUUID() },
      }),
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
    await makePaidPayment(prisma, owner.id);
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

describe('audit_logs is append-only (trigger)', () => {
  it('accepts inserts and reads them back', async () => {
    const entityId = randomUUID();
    await prisma.auditLog.create({ data: { action: 'test.append', entityType: 'test', entityId } });
    expect(await prisma.auditLog.count({ where: { entityId } })).toBe(1);
  });

  it('refuses UPDATE, DELETE and TRUNCATE, through Prisma and raw SQL', async () => {
    const entityId = randomUUID();
    const row = await prisma.auditLog.create({
      data: { action: 'test.append', entityType: 'test', entityId },
    });
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'test.rewritten' } }),
    ).rejects.toThrow(/append-only: UPDATE/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only: DELETE/,
    );
    await expect(
      prisma.$executeRaw`UPDATE audit_logs SET action = 'x' WHERE entity_id = ${entityId}`,
    ).rejects.toThrow(/append-only: UPDATE/);
    await expect(
      prisma.$executeRaw`DELETE FROM audit_logs WHERE entity_id = ${entityId}`,
    ).rejects.toThrow(/append-only: DELETE/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(
      /append-only: TRUNCATE/,
    );
    expect(await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      action: 'test.append',
    });
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
