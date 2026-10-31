/**
 * DEV/TEST ONLY. Creates verified students that each have a PAID registration, so dashboards (and later the exam
 * engine) can be exercised without a real payment. Owner decision 2026-10-30 (option a).
 *
 * Guarded by `assertFixturesAllowed` + a server-side marker check (see guard.ts) and excluded from every Docker image.
 * Users use the reserved `.invalid` TLD: they can never receive mail and are easy to find/delete.
 * The password comes from FIXTURE_PASSWORD (never printed). Idempotent: complete fixture students are skipped, and a
 * fixture student without a registration (e.g. after --clean) gets one again.
 *
 * Rows follow the real payment rules (docs/plans/PAYMENTS-PLAN.md section 4.4): a completed registration attempt,
 * a payment inserted as `initiated` and moved initiated -> pending -> paid, then the registration.
 *
 * Usage (host, dev Postgres started with infra/docker-compose.dev.yml):
 *   ALLOW_DEV_FIXTURES=yes-this-is-not-production pnpm --filter @sirat/api db:fixtures:dev
 *   ALLOW_DEV_FIXTURES=yes-this-is-not-production pnpm --filter @sirat/api db:fixtures:dev --clean
 * --clean removes ONLY the payments and registrations of `@fixtures.invalid` users (users stay). It is needed once,
 * before the payments migration, on a dev database that holds the old fixtures (docs/RUNBOOK.md section 0).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { PaymentStatus, Prisma, PrismaClient, RegistrationAttemptStatus } from '@prisma/client';
import { assertDevServerMarker, assertFixturesAllowed } from './guard';

/** One student per category band (grade sort orders 1, 5, 11 map to activist / ambassador / achiever). */
export const FIXTURE_STUDENTS = [
  { n: 1, gradeSortOrder: 1 },
  { n: 2, gradeSortOrder: 5 },
  { n: 3, gradeSortOrder: 11 },
] as const;

export const FIXTURE_EMAIL_DOMAIN = '@fixtures.invalid';
const FIXTURE_AMOUNT_MINOR = 40000; // the real fee shape: whole taka, BDT
const FIXTURE_GATEWAY_ACCOUNT = 'dev-fixture';

const fixtureEmail = (n: number) => `student${n}${FIXTURE_EMAIL_DOMAIN}`;
const fixturePhone = (n: number) => `0170000000${n}`; // distinct per student: users.phone is UNIQUE
const fixtureInvoice = (n: number) => `FX${String(n).padStart(14, '0')}`; // FX is refused as an account prefix
const fixtureTrxId = (n: number) => `FIXTURETRX${String(n).padStart(4, '0')}`;

export type FixtureResult = { created: number; completed: number; skipped: number };

/** Creates or completes the fixture students. The caller has already checked the guards. */
export async function loadDevFixtures(
  prisma: PrismaClient,
  passwordHash: string,
): Promise<FixtureResult> {
  const result: FixtureResult = { created: 0, completed: 0, skipped: 0 };
  for (const s of FIXTURE_STUDENTS) {
    const email = fixtureEmail(s.n);
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, phone: true, registration: { select: { id: true } } },
    });
    if (existing?.registration) {
      result.skipped += 1;
      continue;
    }
    const grade = await prisma.gradeLevel.findUnique({ where: { sortOrder: s.gradeSortOrder } });
    if (!grade)
      throw new Error('Grade levels missing: apply the migrations first (pnpm db:migrate).');

    await prisma.$transaction(async (tx) => {
      const now = new Date();
      const user = existing
        ? existing.phone
          ? await tx.user.findUniqueOrThrow({ where: { id: existing.id } })
          : await tx.user.update({ where: { id: existing.id }, data: { phone: fixturePhone(s.n) } })
        : await tx.user.create({
            data: {
              email,
              passwordHash,
              name: `Fixture Student ${s.n}`,
              phone: fixturePhone(s.n),
              gradeLevelId: grade.id,
              category: grade.category,
              emailVerifiedAt: now,
              signupSource: 'dev-fixture',
            },
          });
      const attempt = await tx.pendingRegistration.create({
        data: {
          status: RegistrationAttemptStatus.completed,
          email,
          phone: user.phone ?? fixturePhone(s.n),
          name: user.name,
          payload: Prisma.DbNull,
          startRequestId: randomUUID(),
          resumeTokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
          userId: user.id,
          completedAt: now,
        },
      });
      const payment = await tx.payment.create({
        data: {
          userId: user.id,
          pendingRegistrationId: attempt.id,
          invoiceNumber: fixtureInvoice(s.n),
          amountMinor: FIXTURE_AMOUNT_MINOR,
          currency: 'BDT',
          payWithCharge: false,
          gatewayAccount: FIXTURE_GATEWAY_ACCOUNT,
          expiresAt: now,
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.pending },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.paid,
          trxId: fixtureTrxId(s.n),
          paidAmountMinor: FIXTURE_AMOUNT_MINOR,
          paidAt: now,
        },
      });
      await tx.registration.create({ data: { userId: user.id, paymentId: payment.id } });
    });
    if (existing) result.completed += 1;
    else result.created += 1;
  }
  return result;
}

export type CleanResult = { registrations: number; payments: number; attempts: number };

/**
 * Removes the payments and registrations of `@fixtures.invalid` users, and their registration attempts. Users stay.
 * Raw SQL on columns that exist before AND after the payments migration (it runs on an old dev database, before
 * that migration). Other users' rows are never touched. The caller has already checked the guards.
 */
export async function cleanFixturePayments(prisma: PrismaClient): Promise<CleanResult> {
  const pattern = `%${FIXTURE_EMAIL_DOMAIN}`;
  return prisma.$transaction(async (tx) => {
    const fixtureUsers = Prisma.sql`SELECT "id" FROM "users" WHERE "email" LIKE ${pattern}`;
    const registrations = await tx.$executeRaw`
      DELETE FROM "registrations" WHERE "user_id" IN (${fixtureUsers})`;
    const payments = await tx.$executeRaw`
      DELETE FROM "payments" WHERE "user_id" IN (${fixtureUsers})`;
    const [column] = await tx.$queryRaw<{ found: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pending_registrations' AND column_name = 'user_id'
      ) AS "found"`;
    const attempts = column?.found
      ? await tx.$executeRaw`DELETE FROM "pending_registrations" WHERE "user_id" IN (${fixtureUsers})`
      : 0;
    return { registrations, payments, attempts };
  });
}

async function main(): Promise<void> {
  assertFixturesAllowed(process.env);
  const clean = process.argv.slice(2).includes('--clean');
  const password = process.env.FIXTURE_PASSWORD ?? '';
  if (!clean && password.length < 12)
    throw new Error('FIXTURE_PASSWORD must be set (at least 12 characters).');

  // Same (already guarded) URL for every query; the server marker is checked before anything else runs.
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const [row] = await prisma.$queryRaw<
      { marker: string | null }[]
    >`SELECT current_setting('sirat.environment', true) AS marker`;
    assertDevServerMarker(row?.marker);
    if (clean) {
      const removed = await cleanFixturePayments(prisma);
      console.log(JSON.stringify({ msg: 'dev fixture payments removed (users kept)', ...removed }));
      return;
    }
    // A2 (auth) owns the tuned argon2id parameters; library defaults are fine for dev data.
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const result = await loadDevFixtures(prisma, passwordHash);
    console.log(JSON.stringify({ msg: 'dev fixtures done', ...result }));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('dev fixtures failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  });
}
