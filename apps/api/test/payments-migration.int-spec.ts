/**
 * The payments migration on a database that already ran main's earlier migrations and holds main's old dev fixtures
 * (three paid payments of 100 paisa, fee placeholder 0): the order in docs/RUNBOOK.md section 0.
 * 1. migrate first -> the guard stops it, nothing changes, the migration is recorded as failed;
 * 2. mark it rolled back, remove the fixture payments (--clean), migrate again -> applied; the fee becomes 40000;
 * 3. reload the fixtures -> the same three students get paid registrations on the new schema.
 * Runs in a throwaway *_test database; the migration never deletes data (owner rule).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { seedConfig } from '../prisma/seed';
import { cleanFixturePayments, loadDevFixtures } from '../prisma/fixtures/dev-fixtures';

const PRISMA_DIR = join(__dirname, '..', 'prisma');
const M1_SUFFIX = '_payments_registration';

function prismaCli(args: string[], url: string): string {
  return execFileSync('prisma', args, {
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    shell: process.platform === 'win32',
  });
}

/** A copy of the schema folder that holds only the migrations before M1 (main before the payments work). */
function migrationsBeforeM1(): string {
  const all = readdirSync(join(PRISMA_DIR, 'migrations')).sort();
  const m1 = all.find((d) => d.endsWith(M1_SUFFIX));
  if (!m1) throw new Error('payments_registration migration not found');
  const dir = mkdtempSync(join(tmpdir(), 'sirat-pre-m1-'));
  cpSync(join(PRISMA_DIR, 'schema.prisma'), join(dir, 'schema.prisma'));
  cpSync(
    join(PRISMA_DIR, 'migrations', 'migration_lock.toml'),
    join(dir, 'migrations', 'migration_lock.toml'),
  );
  for (const d of all.filter((d) => d < m1 && !d.endsWith('.toml')))
    cpSync(join(PRISMA_DIR, 'migrations', d), join(dir, 'migrations', d), { recursive: true });
  return dir;
}

/** main's old dev fixtures, as their rows looked before the payments migration. */
async function insertOldFixtures(db: PrismaClient): Promise<void> {
  await db.$executeRaw`INSERT INTO "settings" ("key", "value") VALUES ('registration_fee_minor', '0'::jsonb)`;
  for (const n of [1, 2, 3]) {
    const userId = randomUUID();
    const paymentId = randomUUID();
    await db.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "name", "email_verified_at", "signup_source", "updated_at")
      VALUES (${userId}::uuid, ${`student${n}@fixtures.invalid`}, 'old-hash', ${`Fixture Student ${n}`}, now(),
              'dev-fixture', now())`;
    await db.$executeRaw`
      INSERT INTO "payments" ("id", "user_id", "invoice_number", "amount_minor", "status", "trx_id", "expires_at",
                              "paid_at", "updated_at")
      VALUES (${paymentId}::uuid, ${userId}::uuid, ${`FIXTURE-INV-${n}`}, 100, 'paid', ${`FIXTURE-TRX-${n}`}, now(),
              now(), now())`;
    await db.$executeRaw`
      INSERT INTO "registrations" ("id", "user_id", "payment_id", "updated_at")
      VALUES (gen_random_uuid(), ${userId}::uuid, ${paymentId}::uuid, now())`;
  }
  // Someone else's account without a payment: --clean must leave it alone.
  await db.$executeRaw`
    INSERT INTO "users" ("id", "email", "password_hash", "name", "updated_at")
    VALUES (gen_random_uuid(), 'someone@test.invalid', 'h', 'Someone', now())`;
}

/** Runs `prisma migrate deploy` and returns its combined output when it fails ('' when it succeeds). */
function failingDeploy(url: string): string {
  try {
    prismaCli(['migrate', 'deploy'], url);
    return '';
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

const countPaymentColumn = async (db: PrismaClient) => {
  const [row] = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'pending_registration_id'`;
  return row?.n;
};

/** A throwaway *_test database at main's schema before M1, holding main's old fixtures. */
async function withOldDatabase(run: (url: string, db: PrismaClient) => Promise<void>) {
  const base = new URL(process.env.TEST_DATABASE_URL as string);
  const name = `sirat_pm_${randomUUID().slice(0, 8)}_test`;
  const url = new URL(base.toString());
  url.pathname = `/${name}`;
  const adminUrl = new URL(base.toString());
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const preM1 = migrationsBeforeM1();
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); // generated name: safe identifier
    prismaCli(['migrate', 'deploy', '--schema', join(preM1, 'schema.prisma')], url.toString());
    await insertOldFixtures(db);
    await run(url.toString(), db);
  } finally {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$disconnect();
    rmSync(preM1, { recursive: true, force: true });
  }
}

it('test database: prepare-test-db empties the leftover payment rows, clears a failed try and migrates', async () => {
  await withOldDatabase(async (url, db) => {
    expect(failingDeploy(url)).toMatch(/holds 3 payment\(s\)/); // leaves a failed M1 record behind
    const out = execFileSync('node', ['test/prepare-test-db.mjs'], {
      cwd: join(__dirname, '..'),
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, TEST_DATABASE_URL: url },
    });
    expect(out).toMatch(
      /emptied the payment tables of sirat_pm_\w+_test before the payments migration \(3 payments\)/,
    );
    expect(await countPaymentColumn(db)).toBe(1);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM "users"`).toEqual([{ n: 4 }]);
  });
}, 180_000);

it('old dev database: guard stops the migration; clean, migrate and reload work in that order', async () => {
  await withOldDatabase(async (url, firstClient) => {
    let db = firstClient;
    // 1. Migrating first: the guard refuses, explains the way out, and nothing changes.
    const failure = failingDeploy(url);
    expect(failure).toMatch(/holds 3 payment\(s\) and 0 pending registration\(s\)/);
    expect(failure).toMatch(/db:fixtures:dev --clean/);
    expect(await countPaymentColumn(db)).toBe(0);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM "payments"`).toEqual([{ n: 3 }]);

    // 2. The RUNBOOK order: mark it rolled back, clean the fixture payments, migrate.
    const m1 = readdirSync(join(PRISMA_DIR, 'migrations')).find((d) =>
      d.endsWith(M1_SUFFIX),
    ) as string;
    prismaCli(['migrate', 'resolve', '--rolled-back', m1], url);
    expect(await cleanFixturePayments(db)).toEqual({ registrations: 3, payments: 3, attempts: 0 });
    prismaCli(['migrate', 'deploy'], url);

    // A new client: the old one cached the pre-migration column list.
    db = new PrismaClient({ datasourceUrl: url });
    expect(
      (await db.setting.findUniqueOrThrow({ where: { key: 'registration_fee_minor' } })).value,
    ).toBe(40000);
    expect(await db.auditLog.count({ where: { action: 'settings.registration_fee_set' } })).toBe(1);
    await seedConfig(db);

    // 3. Reload: the same three users get phones and paid 400 BDT registrations; the other user is untouched.
    const hash = await argon2.hash('Fixture-river-moon-42', { type: argon2.argon2id });
    expect(await loadDevFixtures(db, hash)).toEqual({ created: 0, completed: 3, skipped: 0 });
    const regs = await db.registration.findMany({
      include: { payment: { select: { status: true, amountMinor: true } } },
    });
    expect(regs).toHaveLength(3);
    expect(regs.every((r) => r.payment.status === 'paid' && r.payment.amountMinor === 40000)).toBe(
      true,
    );
    expect(await db.user.count()).toBe(4);
    await db.$disconnect();
  });
}, 180_000);
