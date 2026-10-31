// Prepares the dedicated integration-test database: creates it if missing, then applies all migrations.
// No reset/drop. Refuses any database whose name does not end with `_test`.
// One exception, for the payments migration (docs/plans/PAYMENTS-PLAN.md section 4.2): it refuses a database that
// holds payments, and older test runs leave payment rows behind. While that migration is not yet applied, the
// leftover test rows of the three payment tables are emptied here (test data only; this file refuses any database
// that is not *_test), and a failed attempt of it is marked rolled back so it can run again.
import { execFileSync } from 'node:child_process';
import prismaPkg from '@prisma/client';

const { PrismaClient } = prismaPkg;
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is not set (see apps/api/.env.example).');
  process.exit(1);
}
const testUrl = new URL(url);
const dbName = testUrl.pathname.replace(/^\//, '');
if (!/^[a-z0-9_]+_test$/.test(dbName)) {
  console.error(`Refusing: the test database name must end with _test (got "${dbName}").`);
  process.exit(1);
}

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
try {
  const rows = await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
  if (rows.length === 0) {
    // dbName is validated by the regex above, so interpolating it as an identifier is safe.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`created database ${dbName}`);
  }
} finally {
  await admin.$disconnect();
}

const prismaEnv = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
const prismaOpts = { env: prismaEnv, shell: process.platform === 'win32' }; // prisma is a .cmd shim on Windows

const PAYMENTS_MIGRATION_SUFFIX = '_payments_registration';
const db = new PrismaClient({ datasourceUrl: url });
try {
  const [state] = await db.$queryRaw`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "hasLog",
           to_regclass('public.payments') IS NOT NULL AS "hasPayments"`;
  if (state.hasLog && state.hasPayments) {
    const runs = await db.$queryRaw`
      SELECT "migration_name" AS name, "finished_at" IS NOT NULL AS done, "rolled_back_at" IS NOT NULL AS undone
      FROM "_prisma_migrations" WHERE "migration_name" LIKE ${'%' + PAYMENTS_MIGRATION_SUFFIX}`;
    if (!runs.some((r) => r.done)) {
      const [counts] = await db.$queryRaw`
        SELECT (SELECT count(*) FROM "payments")::int AS payments,
               (SELECT count(*) FROM "pending_registrations")::int AS pending`;
      if (counts.payments > 0 || counts.pending > 0) {
        await db.$executeRawUnsafe(
          'TRUNCATE TABLE "public"."registrations", "public"."pending_registrations", "public"."payments"',
        );
        console.log(
          `emptied the payment tables of ${dbName} before the payments migration (${counts.payments} payments)`,
        );
      }
      for (const failed of runs.filter((r) => !r.done && !r.undone)) {
        execFileSync('prisma', ['migrate', 'resolve', '--rolled-back', failed.name], {
          ...prismaOpts,
          stdio: 'inherit',
        });
      }
    }
  }
} finally {
  await db.$disconnect();
}

execFileSync('prisma', ['migrate', 'deploy'], { ...prismaOpts, stdio: 'inherit' });
