import type { Prisma, PrismaClient } from '@prisma/client';
import { buildExamResults } from '../attempts/exam-jobs';
import { demoRandom, seedOf } from './demo-random';
import type { DemoContext, DemoGenerator } from './demo.types';
import { announcementsDemoGenerator } from './generators/announcements.demo';
import { examsDemoGenerator } from './generators/exams.demo';
import { usersDemoGenerator } from './generators/users.demo';

/**
 * Every area's generator (DECISIONS 2026-11-08 "Demo data"). The framework orders them by dependsOn; an area added
 * later only appends itself here. Payments adds its registrations, payments and book orders (PR C).
 */
export const DEMO_GENERATORS: readonly DemoGenerator[] = [
  usersDemoGenerator,
  examsDemoGenerator,
  announcementsDemoGenerator,
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
        register: async (table, ids) => {
          for (let i = 0; i < ids.length; i += REGISTER_CHUNK)
            await tx.demoRecord.createMany({
              data: ids
                .slice(i, i + REGISTER_CHUNK)
                .map((rowId) => ({ batchId: opts.batchId, tableName: table, rowId })),
            });
        },
        progress: async (step) => {
          await opts.onProgress?.(step);
        },
      };
      for (const g of orderGenerators(opts.generators ?? DEMO_GENERATORS)) await g.load(ctx);
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
