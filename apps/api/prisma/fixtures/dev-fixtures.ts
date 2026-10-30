/**
 * DEV/TEST ONLY. Creates verified students that each have a PAID registration, so the exam engine can be
 * exercised before Phase C (registration + payment) exists. Owner decision 2026-10-30 (option a).
 *
 * Guarded by `assertFixturesAllowed` + a server-side marker check (see guard.ts) and excluded from every Docker image.
 * Users use the reserved `.invalid` TLD: they can never receive mail and are easy to find/delete.
 * The password comes from FIXTURE_PASSWORD (never printed). Idempotent: existing fixture users are skipped.
 *
 * Usage (host, dev Postgres started with infra/docker-compose.dev.yml):
 *   ALLOW_DEV_FIXTURES=yes-this-is-not-production pnpm --filter @sirat/api db:fixtures:dev
 */
import argon2 from 'argon2';
import { PaymentStatus, PrismaClient } from '@prisma/client';
import { assertDevServerMarker, assertFixturesAllowed } from './guard';

/** One student per category band (grade sort orders 1, 5, 11 map to activist / ambassador / achiever). */
const STUDENTS = [
  { n: 1, gradeSortOrder: 1 },
  { n: 2, gradeSortOrder: 5 },
  { n: 3, gradeSortOrder: 11 },
] as const;

const FIXTURE_AMOUNT_MINOR = 100; // fake amount; payments CHECK requires > 0

async function main(): Promise<void> {
  assertFixturesAllowed(process.env);
  const password = process.env.FIXTURE_PASSWORD ?? '';
  if (password.length < 12) throw new Error('FIXTURE_PASSWORD must be set (at least 12 characters).');

  // Same (already guarded) URL for every query; the server marker is checked before anything else runs.
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const [row] = await prisma.$queryRaw<{ marker: string | null }[]>`SELECT current_setting('sirat.environment', true) AS marker`;
    assertDevServerMarker(row?.marker);
    // A2 (auth) owns the tuned argon2id parameters; library defaults are fine for dev data.
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    let created = 0;
    for (const s of STUDENTS) {
      const email = `student${s.n}@fixtures.invalid`;
      if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) continue;
      const grade = await prisma.gradeLevel.findUnique({ where: { sortOrder: s.gradeSortOrder } });
      if (!grade) throw new Error('Grade levels missing: run the config seed first (pnpm --filter @sirat/api db:seed).');

      await prisma.$transaction(async (tx) => {
        const now = new Date();
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            name: `Fixture Student ${s.n}`,
            gradeLevelId: grade.id,
            category: grade.category,
            emailVerifiedAt: now,
            signupSource: 'dev-fixture',
          },
        });
        const payment = await tx.payment.create({
          data: {
            userId: user.id,
            invoiceNumber: `FIXTURE-INV-${s.n}`,
            amountMinor: FIXTURE_AMOUNT_MINOR,
            status: PaymentStatus.paid,
            trxId: `FIXTURE-TRX-${s.n}`,
            expiresAt: now,
            paidAt: now,
          },
        });
        await tx.registration.create({ data: { userId: user.id, paymentId: payment.id } });
      });
      created += 1;
    }
    console.log(JSON.stringify({ msg: 'dev fixtures done', created, skippedExisting: STUDENTS.length - created }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('dev fixtures failed:', err instanceof Error ? err.message : 'unknown error');
  process.exit(1);
});
