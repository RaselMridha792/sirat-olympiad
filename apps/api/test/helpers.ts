import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const TEST_DB = /^[a-z0-9_]+_test$/;

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
