/**
 * DEV/TEST ONLY: the exam load test's data (EXAM-PLAN 6.2, E6; loadtests/exam-simulation.js). Same guards as the dev
 * fixtures (guard.ts): NODE_ENV, the per-run confirmation, a local URL and the server's dev/test marker, checked before
 * a single row is written; excluded from every Docker image.
 *
 *   ... loadtest-fixtures.ts --users 300           verified students load1..load300 @loadtest.invalid, each with a
 *                                                   paid registration (the payments rule shape, as dev-fixtures.ts);
 *                                                   existing ones are skipped
 *   ... loadtest-fixtures.ts --exam [--questions 30] [--duration 3] [--window-end-in 60]
 *                                                   a new published exam for everyone (window: a minute ago until
 *                                                   --window-end-in minutes from now); prints {"examId", "windowEnd"}
 *   ... loadtest-fixtures.ts --report <examId>     attempts by status, submissions by end reason, attempts still open
 *                                                   past their time, and the database's write counter (for the
 *                                                   "no writes while students only checkpoint" check)
 *
 * Load students log in like every student, with email + participant ID (owner, 2026-11-10), and have no password.
 * Their IDs derive from the load secret FIXTURE_PASSWORD (never printed), so k6 computes the same ones
 * (loadtests/load-id.js, PASSWORD there) and nobody without the secret can guess them on a staging stack.
 * A new exam per run: one attempt per student per exam, and submissions cannot be deleted (by design).
 */
import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PaymentStatus, Prisma, PrismaClient, RegistrationAttemptStatus } from '@prisma/client';
import { assertDevServerMarker, assertFixturesAllowed } from './guard';

export const LOAD_EMAIL_DOMAIN = '@loadtest.invalid';
export const loadEmail = (n: number): string => `load${n}${LOAD_EMAIL_DOMAIN}`;
/** 0150 + 7 digits: apart from the dev fixtures (0170…) and the registration surge (019…). */
const loadPhone = (n: number) => `0150${String(n).padStart(7, '0')}`;
const loadInvoice = (n: number) => `LT${String(n).padStart(14, '0')}`;
const LOAD_AMOUNT_MINOR = 40000;
const LOAD_GATEWAY_ACCOUNT = 'load-fixture';
/** Grade sort orders 1, 5 and 11: one per category band, so a results build has all three. */
const GRADE_SORT_ORDERS = [1, 5, 11] as const;
const BATCH = 200;
export const USERS_MAX = 20_000;

export type UsersResult = { created: number; skipped: number };

/**
 * A load student's participant ID, from the load secret: the student's number in 5 digits (USERS_MAX is under 100,000,
 * so two load students never share one), 5 digits of HMAC-SHA256(secret, "load<n>"), then the Damm check digit.
 * loadtests/load-id.js computes the same in k6; keep both in step. A real ID is drawn at random by the database.
 */
/**
 * Damm's check digit, as @sirat/shared's dammDigit: inlined because these fixtures also run in the migrate image
 * (loadtests/exam-local.sh), which has no workspace packages. The int-spec checks every ID with isParticipantId.
 */
const DAMM = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
] as const;
const damm = (digits: string): number =>
  [...digits].reduce<number>((interim, ch) => DAMM[interim]![Number(ch)]!, 0);

export function loadParticipantId(secret: string, n: number): string {
  const mac = createHmac('sha256', secret).update(`load${n}`).digest('hex');
  const digits =
    String(n).padStart(5, '0') + String(parseInt(mac.slice(0, 8), 16) % 100_000).padStart(5, '0');
  return `ON${digits}${damm(digits)}`;
}

/** Creates load1..loadN (verified, paid registration); existing ones are skipped. Guards checked by the caller. */
export async function ensureLoadUsers(
  prisma: PrismaClient,
  count: number,
  secret: string,
): Promise<UsersResult> {
  const grades = await prisma.gradeLevel.findMany({
    where: { sortOrder: { in: [...GRADE_SORT_ORDERS] } },
    select: { id: true, category: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  });
  if (grades.length !== GRADE_SORT_ORDERS.length)
    throw new Error('Grade levels missing: apply the migrations first (pnpm db:migrate).');

  const result: UsersResult = { created: 0, skipped: 0 };
  for (let from = 1; from <= count; from += BATCH) {
    const numbers = Array.from({ length: Math.min(BATCH, count - from + 1) }, (_, i) => from + i);
    const existing = await prisma.user.findMany({
      where: { email: { in: numbers.map(loadEmail) } },
      select: { email: true },
    });
    const have = new Set(existing.map((u) => u.email));
    const todo = numbers.filter((n) => !have.has(loadEmail(n)));
    result.skipped += numbers.length - todo.length;
    if (!todo.length) continue;

    const rows = todo.map((n) => ({
      n,
      userId: randomUUID(),
      attemptId: randomUUID(),
      paymentId: randomUUID(),
      grade: grades[n % grades.length]!,
    }));
    // One transaction per batch: a batch is either complete or absent, so "existing" always means complete.
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.user.createMany({
        data: rows.map((r) => ({
          id: r.userId,
          email: loadEmail(r.n),
          name: `Load Student ${r.n}`,
          phone: loadPhone(r.n),
          gradeLevelId: r.grade.id,
          category: r.grade.category,
          emailVerifiedAt: now,
          signupSource: 'load-fixture',
        })),
      });
      await tx.pendingRegistration.createMany({
        data: rows.map((r) => ({
          id: r.attemptId,
          status: RegistrationAttemptStatus.completed,
          email: loadEmail(r.n),
          phone: loadPhone(r.n),
          name: `Load Student ${r.n}`,
          payload: Prisma.DbNull,
          startRequestId: randomUUID(),
          resumeTokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
          userId: r.userId,
          completedAt: now,
        })),
      });
      // Payments' rule: inserted as initiated, then initiated -> pending -> paid (the transition trigger checks it).
      await tx.payment.createMany({
        data: rows.map((r) => ({
          id: r.paymentId,
          userId: r.userId,
          pendingRegistrationId: r.attemptId,
          invoiceNumber: loadInvoice(r.n),
          amountMinor: LOAD_AMOUNT_MINOR,
          currency: 'BDT',
          payWithCharge: false,
          gatewayAccount: LOAD_GATEWAY_ACCOUNT,
          gatewayEnv: 'fake', // load-test money: never a PayStation payment
          expiresAt: now,
        })),
      });
      const ids = rows.map((r) => r.paymentId);
      await tx.payment.updateMany({
        where: { id: { in: ids } },
        data: { status: PaymentStatus.pending },
      });
      await tx.$executeRaw`
        UPDATE "payments"
        SET "status" = 'paid', "trx_id" = 'LOADTRX' || "invoice_number", "paid_amount_minor" = "amount_minor",
            "paid_at" = ${now}
        WHERE "id" = ANY(${ids}::uuid[])`;
      await tx.registration.createMany({
        data: rows.map((r) => ({
          userId: r.userId,
          paymentId: r.paymentId,
          participantId: loadParticipantId(secret, r.n),
        })),
      });
    });
    result.created += todo.length;
  }
  return result;
}

export type ExamOptions = { questions: number; duration: number; windowEndInMinutes: number };

/** A new published exam for every category; the pool equals questions per attempt. Guards checked by the caller. */
export async function createLoadExam(
  prisma: PrismaClient,
  opts: ExamOptions,
): Promise<{ examId: string; windowEnd: string }> {
  const now = Date.now();
  const windowEnd = new Date(now + opts.windowEndInMinutes * 60_000);
  const keys = ['A', 'B', 'C', 'D'];
  const exam = await prisma.exam.create({
    data: {
      title: `Load test ${new Date(now).toISOString()}`,
      category: null,
      windowStart: new Date(now - 60_000),
      windowEnd,
      durationMinutes: opts.duration,
      questionsPerAttempt: opts.questions,
      graceSeconds: 30,
      questions: {
        create: Array.from({ length: opts.questions }, (_, i) => ({
          lineageId: randomUUID(),
          text: `Load question ${i + 1}`,
          options: keys.map((key) => ({ key, text: `Option ${key} of question ${i + 1}` })),
          correctKey: keys[randomInt(keys.length)]!,
          position: i + 1,
        })),
      },
    },
    select: { id: true },
  });
  await prisma.exam.update({
    where: { id: exam.id },
    data: { status: 'published', publishedAt: new Date() },
  });
  return { examId: exam.id, windowEnd: windowEnd.toISOString() };
}

export type LoadReport = {
  examId: string;
  attempts: Record<string, number>;
  submissions: Record<string, number>;
  /** In progress although their time and the grace are over: the sweep has not finalized them (yet). */
  overdueOpen: number;
  /** Rows inserted, updated and deleted in every table since the server started (pg_stat_user_tables). */
  writes: number;
};

export async function loadReport(prisma: PrismaClient, examId: string): Promise<LoadReport> {
  const attempts = await prisma.attempt.groupBy({
    by: ['status'],
    where: { examId },
    _count: { _all: true },
  });
  const submissions = await prisma.submission.groupBy({
    by: ['endReason'],
    where: { attempt: { examId } },
    _count: { _all: true },
  });
  const [overdue] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "attempts" a JOIN "exams" e ON e."id" = a."exam_id"
    WHERE a."exam_id" = ${examId}::uuid AND a."status" = 'in_progress'
      AND a."ends_at" + e."grace_seconds" * interval '1 second' < now()`;
  const [writes] = await prisma.$queryRaw<{ n: bigint | null }[]>`
    SELECT sum("n_tup_ins" + "n_tup_upd" + "n_tup_del") AS n FROM "pg_stat_user_tables"`;
  return {
    examId,
    attempts: Object.fromEntries(attempts.map((a) => [a.status, a._count._all])),
    submissions: Object.fromEntries(submissions.map((s) => [s.endReason, s._count._all])),
    overdueOpen: Number(overdue?.n ?? 0),
    writes: Number(writes?.n ?? 0),
  };
}

function intArg(args: string[], name: string, fallback: number, min: number, max: number): number {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const value = Number(args[i + 1]);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return value;
}

async function main(): Promise<void> {
  assertFixturesAllowed(process.env);
  const args = process.argv.slice(2);
  const reportIndex = args.indexOf('--report');
  const reportExam = reportIndex === -1 ? null : (args[reportIndex + 1] ?? '');
  if (reportExam !== null && !/^[0-9a-f-]{36}$/i.test(reportExam))
    throw new Error('--report needs the exam id.');
  const users = args.includes('--users') ? intArg(args, '--users', 0, 1, USERS_MAX) : 0;
  const exam = args.includes('--exam');
  if (!users && !exam && reportExam === null)
    throw new Error('Nothing to do: --users <n>, --exam and/or --report <examId>.');
  const password = process.env.FIXTURE_PASSWORD ?? '';
  if (users && password.length < 12)
    throw new Error('FIXTURE_PASSWORD must be set (at least 12 characters).');

  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const [row] = await prisma.$queryRaw<
      { marker: string | null }[]
    >`SELECT current_setting('sirat.environment', true) AS marker`;
    assertDevServerMarker(row?.marker);
    if (users) {
      const started = Date.now();
      const result = await ensureLoadUsers(prisma, users, password);
      console.log(
        JSON.stringify({ msg: 'load students', ...result, seconds: (Date.now() - started) / 1000 }),
      );
    }
    if (exam) {
      const created = await createLoadExam(prisma, {
        questions: intArg(args, '--questions', 30, 1, 200),
        duration: intArg(args, '--duration', 3, 1, 30),
        windowEndInMinutes: intArg(args, '--window-end-in', 60, 2, 24 * 60),
      });
      console.log(JSON.stringify({ msg: 'load exam', ...created }));
    }
    if (reportExam !== null)
      console.log(
        JSON.stringify({ msg: 'load report', ...(await loadReport(prisma, reportExam)) }),
      );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('load fixtures failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  });
}
