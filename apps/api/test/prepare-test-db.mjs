// Prepares the dedicated integration-test database: creates it if missing, then applies all migrations.
// No reset/drop. Refuses any database whose name does not end with `_test`.
// One exception, for migrations that refuse a database holding rows of their tables: the payments migration
// (docs/plans/PAYMENTS-PLAN.md section 4.2) and the exam engine migration (docs/plans/EXAM-PLAN.md section 2.3). Older
// test runs leave such rows behind. While such a migration is not yet applied, the leftover test rows of its tables
// are emptied here (test data only; this file refuses any database that is not *_test), and a failed attempt of it is
// marked rolled back so it can run again.
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

// Each guarded migration: the suffix of its directory name, the tables it refuses to find rows in (with their
// dependants), emptied together in one TRUNCATE before `migrate deploy`, and the line it logs (from the row counts per
// table). Fixed names only, never input.
const GUARDED_MIGRATIONS = [
  {
    suffix: '_payments_registration',
    tables: ['registrations', 'pending_registrations', 'payments'],
    report: (n) =>
      `emptied the payment tables of ${dbName} before the payments migration (${n.payments} payments)`,
  },
  {
    suffix: '_exam_engine',
    tables: ['submissions', 'attempts', 'questions'],
    report: (n) =>
      `emptied the exam tables of ${dbName} before the exam migration (${n.submissions + n.attempts + n.questions} rows)`,
  },
];

const db = new PrismaClient({ datasourceUrl: url });
try {
  const [state] = await db.$queryRaw`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "hasLog"`;
  for (const guarded of state.hasLog ? GUARDED_MIGRATIONS : []) {
    const runs = await db.$queryRaw`
      SELECT "migration_name" AS name, "finished_at" IS NOT NULL AS done, "rolled_back_at" IS NOT NULL AS undone
      FROM "_prisma_migrations" WHERE "migration_name" LIKE ${'%' + guarded.suffix}`;
    if (runs.some((r) => r.done)) continue;
    const [present] = await db.$queryRaw`
      SELECT count(*)::int AS n FROM unnest(${guarded.tables}::text[]) AS t(name)
      WHERE to_regclass('public.' || quote_ident(t.name)) IS NOT NULL`;
    if (present.n !== guarded.tables.length) continue; // an older database: these tables come with later migrations
    const counts = {};
    for (const table of guarded.tables) {
      const [row] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "public"."${table}"`);
      counts[table] = row.n;
    }
    if (Object.values(counts).some((n) => n > 0)) {
      const list = guarded.tables.map((t) => `"public"."${t}"`).join(', ');
      await db.$executeRawUnsafe(`TRUNCATE TABLE ${list}`);
      console.log(guarded.report(counts));
    }
    for (const failed of runs.filter((r) => !r.done && !r.undone)) {
      execFileSync('prisma', ['migrate', 'resolve', '--rolled-back', failed.name], {
        ...prismaOpts,
        stdio: 'inherit',
      });
    }
  }
} finally {
  await db.$disconnect();
}

execFileSync('prisma', ['migrate', 'deploy'], { ...prismaOpts, stdio: 'inherit' });

// The runtime role (LAUNCH-PLAN L2). Its password is never set here: one Postgres cluster serves every session, and the
// first stack turn after L2 (prisma/runtime-role.ts in the migrate job) sets it; CI creates the role with its own
// throwaway password. Here we only check that the app's connection will work, and say what to do if not.
const appUrl = process.env.TEST_APP_DATABASE_URL;
if (appUrl) {
  const app = new PrismaClient({ datasourceUrl: appUrl });
  try {
    await app.$queryRaw`SELECT 1`;
  } catch {
    console.error(
      'TEST_APP_DATABASE_URL: sirat_app cannot log in. Its password is set once per cluster by prisma/runtime-role.ts ' +
        '(the migrate job of the first stack turn after L2, from POSTGRES_APP_PASSWORD in the root .env); the value ' +
        'in apps/api/.env must be the same. Without TEST_APP_DATABASE_URL the tests run the app as the owner.',
    );
    process.exit(1);
  } finally {
    await app.$disconnect();
  }
}
