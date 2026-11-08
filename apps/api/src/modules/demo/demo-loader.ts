import type { PrismaClient } from '@prisma/client';
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

export interface DemoLoadOptions {
  batchId: string;
  passwordHash: string;
  now?: Date;
  generators?: readonly DemoGenerator[];
  onProgress?: (step: string) => Promise<void> | void;
}

export interface DemoLoaded {
  counts: Record<string, number>;
  exams: { practice: string | null; round1: string | null };
}

/**
 * Runs every generator inside ONE transaction (all or nothing), registering each inserted row in demo_records. Then,
 * outside it, Round 1's results snapshot (the worker's own buildExamResults) and its publication, so the leaderboard
 * and the review fill (demo_clear removes its leaderboard rows by the exam). The batch row must exist with status 'loading'.
 */
export async function loadDemo(prisma: PrismaClient, opts: DemoLoadOptions): Promise<DemoLoaded> {
  const counts: Record<string, number> = {};
  const exams: DemoLoaded['exams'] = { practice: null, round1: null };
  const progress = async (step: string) => {
    await opts.onProgress?.(step);
  };
  await prisma.$transaction(
    async (tx) => {
      const ctx: DemoContext = {
        tx,
        batchId: opts.batchId,
        now: opts.now ?? new Date(),
        rng: demoRandom(seedOf(opts.batchId)),
        passwordHash: opts.passwordHash,
        users: { students: [], ambassadors: [], jury: [] },
        exams,
        register: async (table, ids) => {
          for (let i = 0; i < ids.length; i += REGISTER_CHUNK)
            await tx.demoRecord.createMany({
              data: ids
                .slice(i, i + REGISTER_CHUNK)
                .map((rowId) => ({ batchId: opts.batchId, tableName: table, rowId })),
            });
        },
        count: (key, n) => {
          counts[key] = (counts[key] ?? 0) + n;
        },
        progress,
      };
      for (const g of orderGenerators(opts.generators ?? DEMO_GENERATORS)) await g.load(ctx);
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  if (exams.round1) {
    await progress('results');
    if ((await buildExamResults(prisma, exams.round1)) === 'built') {
      await prisma.$executeRaw`
        UPDATE "exams" SET "results_published_at" = now() WHERE "id" = ${exams.round1}::uuid`;
      // leaderboard_entries has no single id: demo_clear deletes them by the demo exam, so they are only counted.
      counts.leaderboard_entries = await prisma.leaderboardEntry.count({
        where: { examId: exams.round1 },
      });
    }
  }
  return { counts, exams };
}
