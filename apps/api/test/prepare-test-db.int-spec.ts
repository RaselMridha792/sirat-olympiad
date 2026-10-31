/**
 * The exam engine migration on an old test database (EXAM-PLAN 2.3, lead review): main's constraint tests left exams,
 * attempts and submissions (`answers: {}`) in every existing *_test database, which the migration's guard and CHECKs
 * refuse. prepare-test-db.mjs must empty those rows first, then apply both exam migrations.
 * Builds a scratch *_test database at the state before the exam migration, with such rows, and runs the real script.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const API_DIR = join(__dirname, '..');
const MIGRATIONS = join(API_DIR, 'prisma', 'migrations');
const shell = process.platform === 'win32';

const baseUrl = new URL(process.env.TEST_DATABASE_URL!);
const scratchName = baseUrl.pathname.replace(/^\//, '').replace(/_test$/, '_prep_test');
const scratchUrl = new URL(baseUrl);
scratchUrl.pathname = `/${scratchName}`;
const adminUrl = new URL(baseUrl);
adminUrl.pathname = '/postgres';

async function admin(sql: string): Promise<void> {
  const client = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    await client.$executeRawUnsafe(sql);
  } finally {
    await client.$disconnect();
  }
}

const dropScratch = () => admin(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);

afterAll(async () => {
  await dropScratch();
});

it('empties old exam rows, then applies the exam migrations', async () => {
  expect(scratchName).toMatch(/^[a-z0-9_]+_prep_test$/);
  await dropScratch();
  await admin(`CREATE DATABASE "${scratchName}"`);

  // 1. Every migration before the exam engine, from a copy of the migrations folder.
  const before = mkdtempSync(join(tmpdir(), 'exam-premigration-'));
  try {
    cpSync(join(API_DIR, 'prisma', 'schema.prisma'), join(before, 'schema.prisma'));
    cpSync(
      join(MIGRATIONS, 'migration_lock.toml'),
      join(before, 'migrations', 'migration_lock.toml'),
    );
    for (const dir of readdirSync(MIGRATIONS).filter((d) => d < '20261031183000'))
      cpSync(join(MIGRATIONS, dir), join(before, 'migrations', dir), { recursive: true });
    const env = {
      ...process.env,
      DATABASE_URL: scratchUrl.toString(),
      DIRECT_URL: scratchUrl.toString(),
    };
    execFileSync('prisma', ['migrate', 'deploy', '--schema', join(before, 'schema.prisma')], {
      cwd: API_DIR,
      env,
      shell,
      stdio: 'pipe',
    });
  } finally {
    rmSync(before, { recursive: true, force: true });
  }

  // 2. The rows main's old constraint tests left behind (the old column set: no question_count, no end_reason).
  const scratch = new PrismaClient({ datasourceUrl: scratchUrl.toString() });
  try {
    await scratch.$executeRawUnsafe(`
      INSERT INTO "users" ("id", "email", "password_hash", "name")
      VALUES ('00000000-0000-7000-8000-000000000001', 'old@test.invalid', 'x', 'Old')`);
    await scratch.$executeRawUnsafe(`
      INSERT INTO "exams" ("id", "title", "window_start", "window_end", "duration_minutes", "questions_per_attempt")
      VALUES ('00000000-0000-7000-8000-000000000002', 'Old exam', now(), now() + interval '1 day', 30, 20)`);
    await scratch.$executeRawUnsafe(`
      INSERT INTO "attempts" ("id", "user_id", "exam_id", "started_at", "ends_at", "layout")
      VALUES ('00000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-000000000001',
              '00000000-0000-7000-8000-000000000002', now(), now() + interval '30 minutes', '[]')`);
    await scratch.$executeRawUnsafe(`
      INSERT INTO "submissions" ("id", "attempt_id", "request_id", "answers")
      VALUES ('00000000-0000-7000-8000-000000000004', '00000000-0000-7000-8000-000000000003', 'old-request', '{}')`);
  } finally {
    await scratch.$disconnect();
  }

  // 3. The real script, pointed at the scratch database.
  const out = execFileSync('node', ['test/prepare-test-db.mjs'], {
    cwd: API_DIR,
    env: { ...process.env, TEST_DATABASE_URL: scratchUrl.toString() },
    shell,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  expect(out).toMatch(
    /emptied the exam tables of \w+_prep_test before the exam migration \(2 rows\)/,
  );

  const after = new PrismaClient({ datasourceUrl: scratchUrl.toString() });
  try {
    const applied = await after.$queryRaw<{ name: string }[]>`
      SELECT "migration_name" AS name FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL AND "migration_name" LIKE '%exam%' ORDER BY 1`;
    expect(applied.map((r) => r.name)).toEqual([
      '20261031183000_exam_engine',
      '20261031183100_exam_checks',
    ]);
    // The old draft exam stays (nothing in the exam migrations refuses it); the old attempt and submission are gone.
    expect(await after.exam.count()).toBe(1);
    expect(await after.attempt.count()).toBe(0);
  } finally {
    await after.$disconnect();
  }
});
