import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';

const TEST_DB = /^[a-z0-9_]+_test$/;
const MIGRATIONS = join(__dirname, '..', 'prisma', 'migrations');

/** The SQL statements of the reference-data baseline migration, read from the real migration file. */
export function referenceDataStatements(): string[] {
  const dir = readdirSync(MIGRATIONS).find((d) => d.endsWith('_reference_data_baseline'));
  if (!dir) throw new Error('reference_data_baseline migration not found');
  const sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Re-applies the baseline data migration (after truncateAll), exactly as `prisma migrate deploy` would. */
export async function applyReferenceData(prisma: PrismaClient): Promise<void> {
  for (const statement of referenceDataStatements()) await prisma.$executeRawUnsafe(statement);
}

/** Prisma client bound to TEST_DATABASE_URL. Refuses anything that is not a *_test database. */
export function testPrisma(): PrismaClient {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const db = new URL(url).pathname.replace(/^\//, '');
  if (!TEST_DB.test(db))
    throw new Error(`Refusing: test database must end with _test (got "${db}")`);
  return new PrismaClient({ datasourceUrl: url });
}

/** Empties every application table. Double-checks the connected database is a *_test database first. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const db = row?.db ?? '';
  if (!TEST_DB.test(db)) throw new Error(`Refusing to truncate non-test database "${db}"`);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

const uniq = (): string => randomUUID().slice(0, 8);

export function makeUser(
  prisma: PrismaClient,
  data: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  return prisma.user.create({
    data: {
      email: `u-${uniq()}@test.invalid`,
      passwordHash: 'not-a-real-hash',
      name: 'Test User',
      ...data,
    },
  });
}

export function examData(
  data: Partial<Prisma.ExamUncheckedCreateInput> = {},
): Prisma.ExamUncheckedCreateInput {
  return {
    title: `Exam ${uniq()}`,
    windowStart: new Date('2026-11-01T04:00:00Z'),
    windowEnd: new Date('2026-11-02T18:00:00Z'),
    durationMinutes: 30,
    questionsPerAttempt: 20,
    ...data,
  };
}

export function paymentData(
  data: Partial<Prisma.PaymentUncheckedCreateInput> = {},
): Prisma.PaymentUncheckedCreateInput {
  return {
    invoiceNumber: `INV-${uniq()}`,
    amountMinor: 50000,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...data,
  };
}

export function makeAttempt(prisma: PrismaClient, userId: string, examId: string) {
  const startedAt = new Date();
  return prisma.attempt.create({
    data: {
      userId,
      examId,
      startedAt,
      endsAt: new Date(startedAt.getTime() + 30 * 60 * 1000),
      layout: [],
    },
  });
}
