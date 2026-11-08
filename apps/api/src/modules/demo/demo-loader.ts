import type { Prisma, PrismaClient } from '@prisma/client';
import { buildExamResults } from '../attempts/exam-jobs';
import { paymentsDemoGenerator } from '../payments/demo/payments.demo';
import { demoRandom, seedOf } from './demo-random';
import type { DemoContext, DemoGenerator, DemoUser } from './demo.types';
import { ambassadorsDemoGenerator } from './generators/ambassadors.demo';
import { announcementsDemoGenerator } from './generators/announcements.demo';
import { examsDemoGenerator } from './generators/exams.demo';
import { progressDemoGenerator } from './generators/progress.demo';
import { roundsDemoGenerator } from './generators/rounds.demo';
import { usersDemoGenerator } from './generators/users.demo';

/**
 * Every area's generator (DECISIONS 2026-11-08 "Demo data"). The framework orders them by dependsOn; an area added
 * later only appends itself here. Payments adds its attempts, payments, registrations and book orders.
 */
export const DEMO_GENERATORS: readonly DemoGenerator[] = [
  usersDemoGenerator,
  roundsDemoGenerator,
  examsDemoGenerator,
  announcementsDemoGenerator,
  paymentsDemoGenerator,
  ambassadorsDemoGenerator,
  progressDemoGenerator,
];

/** The generators in dependency order (each after everything it depends on); throws on a cycle or a missing area. */
export function orderGenerators(generators: readonly DemoGenerator[]): DemoGenerator[] {
  const byArea = new Map(generators.map((g) => [g.area, g]));
  const done = new Set<string>();
  const out: DemoGenerator[] = [];
  const visit = (g: DemoGenerator, path: string[]) => {
    if (done.has(g.area)) return;
    if (path.includes(g.area))
      throw new Error(`demo generators: a cycle (${[...path, g.area].join(' -> ')})`);
    for (const dep of g.dependsOn) {
      const d = byArea.get(dep);
      if (!d) throw new Error(`demo generators: ${g.area} depends on a missing area ${dep}`);
      visit(d, [...path, g.area]);
    }
    done.add(g.area);
    out.push(g);
  };
  for (const g of generators) visit(g, []);
  return out;
}

const REGISTER_CHUNK = 1000;
/** The whole load is one transaction; 300 students with their attempts take a few seconds. */
const LOAD_TIMEOUT_MS = 120_000;

export interface DemoGenerateOptions {
  batchId: string;
  passwordHash: string;
  now?: Date;
  generators?: readonly DemoGenerator[];
  onProgress?: (step: string) => Promise<void> | void;
  /** Runs first inside the transaction (the payments guard); a thrown error rolls everything back. */
  guard?: (tx: Prisma.TransactionClient) => Promise<void>;
}

/**
 * Runs every generator inside ONE transaction (all or nothing), registering each inserted row in demo_records. The
 * batch row must exist with status 'loading'; it is locked for the transaction, so a removal waits (demo_clear raises
 * demo_clear_busy for a loading batch anyway).
 */
export async function generateDemo(prisma: PrismaClient, opts: DemoGenerateOptions): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const [batch] = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "demo_batches" WHERE "id" = ${opts.batchId}::uuid FOR UPDATE`;
      if (batch?.status !== 'loading') throw new Error('demo load: the batch is not loading');
      await opts.guard?.(tx);
      const ctx: DemoContext = {
        tx,
        batchId: opts.batchId,
        now: opts.now ?? new Date(),
        rng: demoRandom(seedOf(opts.batchId)),
        passwordHash: opts.passwordHash,
        users: { students: [], ambassadors: [], jury: [] },
        exams: { practice: null, round1: null },
        rounds: null,
        adminId: await demoAdmin(tx, opts.batchId),
        register: registrar(tx, opts.batchId),
        progress: async (step) => {
          await opts.onProgress?.(step);
        },
      };
      for (const g of orderGenerators(inPhase(opts.generators ?? DEMO_GENERATORS, 'load')))
        await g.load(ctx);
    },
    { timeout: LOAD_TIMEOUT_MS, maxWait: 10_000 },
  );
}

const inPhase = (generators: readonly DemoGenerator[], phase: 'load' | 'afterResults') =>
  generators.filter((g) => (g.phase ?? 'load') === phase);

const registrar =
  (tx: Prisma.TransactionClient, batchId: string) =>
  async (table: string, ids: readonly string[]): Promise<void> => {
    for (let i = 0; i < ids.length; i += REGISTER_CHUNK)
      await tx.demoRecord.createMany({
        data: ids
          .slice(i, i + REGISTER_CHUNK)
          .map((rowId) => ({ batchId, tableName: table, rowId })),
      });
  };

/**
 * The admin for admin-only columns (DECISIONS "Demo data", D4): the admin who clicked, else the oldest active admin
 * (the CLI has no clicking admin); null when there is none. A demo account is never an admin (users_demo_role_check).
 */
export async function demoAdmin(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<string | null> {
  const batch = await tx.demoBatch.findUnique({
    where: { id: batchId },
    select: { createdById: true },
  });
  if (batch?.createdById) return batch.createdById;
  const oldest = await tx.user.findFirst({
    where: { role: 'admin', isBlocked: false, demoBatchId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return oldest?.id ?? null;
}

/** Whether a batch's after-results pass already committed (its marker: a registered round entry). */
export async function demoAfterResultsDone(
  prisma: PrismaClient,
  batchId: string,
): Promise<boolean> {
  return (
    (await prisma.demoRecord.findFirst({
      where: { batchId, tableName: 'round_entries' },
      select: { rowId: true },
    })) !== null
  );
}

/**
 * The 'afterResults' generators, in their own transaction once the demo exams' results are published. The context is
 * read back from the database (the load transaction's is gone, and a retried job may have skipped it); the random
 * numbers continue from a second seed, so a retry gives the same rows. The batch must still be 'loading'.
 */
export async function generateDemoAfterResults(
  prisma: PrismaClient,
  opts: Pick<DemoGenerateOptions, 'batchId' | 'now' | 'generators' | 'onProgress'>,
): Promise<void> {
  const generators = inPhase(opts.generators ?? DEMO_GENERATORS, 'afterResults');
  if (generators.length === 0) return;
  await prisma.$transaction(
    async (tx) => {
      const [batch] = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "demo_batches" WHERE "id" = ${opts.batchId}::uuid FOR UPDATE`;
      if (batch?.status !== 'loading') throw new Error('demo load: the batch is not loading');
      const users = await tx.user.findMany({
        where: { demoBatchId: opts.batchId },
        orderBy: { email: 'asc' },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          role: true,
          district: true,
          institution: true,
          educationType: true,
          gradeLevelId: true,
          category: true,
        },
      });
      const as = (role: DemoUser['role']) =>
        users
          .filter((u) => u.role === role)
          .map((u) => ({
            ...u,
            role,
            phone: u.phone ?? '',
            district: u.district ?? '',
            institution: u.institution ?? '',
            educationType: u.educationType ?? '',
          }));
      const exams = await tx.exam.findMany({
        where: { demoBatchId: opts.batchId },
        select: { id: true, roundId: true },
      });
      const rounds = await tx.round.findMany({
        where: { demoBatchId: opts.batchId },
        select: { id: true, type: true },
      });
      const byType = (t: string) => rounds.find((r) => r.type === t)?.id;
      const r1 = byType('quiz');
      const video = byType('video');
      const final = byType('final');
      const ctx: DemoContext = {
        tx,
        batchId: opts.batchId,
        now: opts.now ?? new Date(),
        rng: demoRandom((seedOf(opts.batchId) ^ 0x5bd1e995) >>> 0),
        passwordHash: '',
        users: { students: as('student'), ambassadors: as('ambassador'), jury: as('jury') },
        exams: {
          practice: exams.find((e) => e.roundId === null)?.id ?? null,
          round1: exams.find((e) => e.roundId !== null && e.roundId === r1)?.id ?? null,
        },
        rounds: r1 && video && final ? { r1, video, final } : null,
        adminId: await demoAdmin(tx, opts.batchId),
        register: registrar(tx, opts.batchId),
        progress: async (step) => {
          await opts.onProgress?.(step);
        },
      };
      for (const g of orderGenerators(generators)) await g.load(ctx);
    },
    { timeout: LOAD_TIMEOUT_MS, maxWait: 10_000 },
  );
}

/** Whether a batch's generators already committed (a retried job then goes straight to the results). */
export async function demoGenerated(prisma: PrismaClient, batchId: string): Promise<boolean> {
  return (
    (await prisma.demoRecord.findFirst({
      where: { batchId, tableName: 'users' },
      select: { rowId: true },
    })) !== null
  );
}

/**
 * After the commit: the results snapshot of each of the batch's closed exams (the worker's own buildExamResults, which
 * needs the committed attempts), then its publication, so the leaderboard and the review fill. Idempotent: a published
 * exam is skipped. demo_clear removes the leaderboard rows by the exam.
 */
export async function publishDemoResults(prisma: PrismaClient, batchId: string): Promise<number> {
  const exams = await prisma.$queryRaw<{ id: string }[]>`
    SELECT e."id"::text AS "id" FROM "exams" e
    JOIN "demo_records" r ON r."table_name" = 'exams' AND r."row_id" = e."id"::text AND r."batch_id" = e."demo_batch_id"
    WHERE e."demo_batch_id" = ${batchId}::uuid AND e."results_published_at" IS NULL
      AND e."window_end" + make_interval(secs => e."grace_seconds") < now()`;
  let published = 0;
  for (const { id } of exams) {
    if ((await buildExamResults(prisma, id)) !== 'built') continue;
    published += await prisma.$executeRaw`
      UPDATE "exams" SET "results_published_at" = now()
      WHERE "id" = ${id}::uuid AND "results_published_at" IS NULL AND "results_snapshot_at" IS NOT NULL`;
  }
  return published;
}

/**
 * What a batch holds, from the database (so a retried job counts right): the demo accounts by role, every other
 * registered table by its name, and the leaderboard rows of its exams.
 */
export async function demoCounts(
  prisma: PrismaClient,
  batchId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const roles = await prisma.$queryRaw<{ role: string; n: number }[]>`
    SELECT "role"::text AS "role", count(*)::int AS "n" FROM "users"
    WHERE "demo_batch_id" = ${batchId}::uuid GROUP BY 1`;
  const plural: Record<string, string> = {
    student: 'students',
    ambassador: 'ambassadors',
    jury: 'jury',
  };
  for (const r of roles) counts[plural[r.role] ?? r.role] = r.n;
  const tables = await prisma.$queryRaw<{ table: string; n: number }[]>`
    SELECT "table_name" AS "table", count(*)::int AS "n" FROM "demo_records"
    WHERE "batch_id" = ${batchId}::uuid AND "table_name" <> 'users' GROUP BY 1`;
  for (const t of tables) counts[t.table] = t.n;
  const [board] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS "n" FROM "leaderboard_entries" l
    JOIN "exams" e ON e."id" = l."exam_id" WHERE e."demo_batch_id" = ${batchId}::uuid`;
  if (board && board.n > 0) counts.leaderboard_entries = board.n;
  return counts;
}
