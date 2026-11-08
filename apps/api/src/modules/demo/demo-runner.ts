import type { Prisma, PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import type { DemoAction, DemoOutcome } from '@sirat/shared';
import { withTimeout } from '../../common/with-timeout';
import { STATS_KEY } from '../admin/admin-stats.service';
import { GENERATION_KEY } from '../announcements/announcements.service';
import { keys as examKeys } from '../exams/exam-cache';
import { demoCounts, demoGenerated, generateDemo, publishDemoResults } from './demo-loader';

/** The running or last job, in the cache Redis (best effort: without it the card shows no progress). */
export const DEMO_JOB_KEY = 'demo:job';
const JOB_KEY_TTL_S = 86_400;
const REDIS_TIMEOUT_MS = 500;

export interface DemoJobState {
  action: DemoAction;
  /** The running step; null once the job ended. */
  step: string | null;
  outcome: DemoOutcome | null;
}

/** demo_clear refused: real rows use demo rows (counts per kind). Nothing was removed. */
export class DemoClearBlocked extends Error {
  constructor(readonly blockers: Record<string, number>) {
    super('demo_clear_blocked');
  }
}

/** demo_clear refused: the batch is still loading. */
export class DemoClearBusy extends Error {
  constructor() {
    super('demo_clear_busy');
  }
}

export interface DemoRunnerDeps {
  prisma: PrismaClient;
  /** The cache Redis, for progress and the invalidation; null (the CLI without REDIS_CACHE_URL) skips both. */
  cache: Redis | null;
  /** Runs inside the load transaction before any write (payments' guard); throws to refuse. */
  guard?: (tx: Prisma.TransactionClient) => Promise<void>;
}

/**
 * The demo data's load and removal, shared by the worker's jobs and the CLI (DECISIONS 2026-11-08 "Demo data"). The
 * database is the authority: the batch's status says what may run, and demo_clear (SECURITY DEFINER) is the only way
 * rows go. Both steps are idempotent, so a retried job is safe.
 */
export class DemoRunner {
  constructor(private readonly deps: DemoRunnerDeps) {}

  /**
   * Loads a batch in status 'loading': the generators in one transaction (skipped when they already committed), then
   * the results of its closed exams, then 'loaded' with the counts. Returns the counts, or null when the batch is not
   * loading (done before, or removed).
   */
  async load(batchId: string, passwordHash: string): Promise<Record<string, number> | null> {
    const { prisma } = this.deps;
    const batch = await prisma.demoBatch.findUnique({
      where: { id: batchId },
      select: { status: true },
    });
    if (batch?.status !== 'loading') return null;
    await this.state({ action: 'load', step: 'starting', outcome: null });
    if (!(await demoGenerated(prisma, batchId)))
      await generateDemo(prisma, {
        batchId,
        passwordHash,
        guard: this.deps.guard,
        onProgress: (step) => this.state({ action: 'load', step, outcome: null }),
      });
    await this.state({ action: 'load', step: 'results', outcome: null });
    await publishDemoResults(prisma, batchId);
    const counts = await demoCounts(prisma, batchId);
    const done = await prisma.demoBatch.updateMany({
      where: { id: batchId, status: 'loading' },
      data: { status: 'loaded', counts },
    });
    await this.invalidate(await this.examIds(batchId));
    await this.ended('load', 'done');
    return done.count === 1 ? counts : null;
  }

  /** A load that failed for good: 'failed' (the admin removes what it left), and the card says so. */
  async loadFailed(batchId: string): Promise<void> {
    await this.deps.prisma.demoBatch.updateMany({
      where: { id: batchId, status: 'loading' },
      data: { status: 'failed' },
    });
    await this.invalidate(await this.examIds(batchId));
    await this.ended('load', 'failed');
  }

  /**
   * Removes a batch through demo_clear. Returns the deleted rows per table, or null when there was no batch. Throws
   * DemoClearBlocked (real rows use demo rows: nothing removed) or DemoClearBusy (still loading).
   */
  async clear(batchId: string): Promise<Record<string, number> | null> {
    const { prisma } = this.deps;
    const exists = await prisma.demoBatch.count({ where: { id: batchId } });
    if (exists === 0) return null;
    const exams = await this.examIds(batchId);
    await this.state({ action: 'clear', step: 'removing', outcome: null });
    let counts: Record<string, number>;
    try {
      const [row] = await prisma.$queryRaw<{ counts: Record<string, number> }[]>`
        SELECT "demo_clear"(${batchId}::uuid) AS "counts"`;
      counts = row?.counts ?? {};
    } catch (e) {
      throw clearRefusal(e) ?? e;
    }
    await this.invalidate(exams);
    await this.ended('clear', 'done');
    return counts;
  }

  /** A removal refused or failed for good: the batch gets its status back; the card shows why. */
  async clearRefused(
    batchId: string,
    previous: 'loaded' | 'failed',
    blockers?: Record<string, number>,
  ): Promise<void> {
    await this.deps.prisma.demoBatch.updateMany({
      where: { id: batchId, status: 'clearing' },
      data: { status: previous },
    });
    await this.ended('clear', blockers ? 'blocked' : 'failed', blockers);
  }

  /** The running or last job; null without the cache Redis or after a day. */
  async jobState(): Promise<DemoJobState | null> {
    const raw = await this.safe((r) => r.get(DEMO_JOB_KEY));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DemoJobState;
    } catch {
      return null;
    }
  }

  /** Records that an action was asked for (the API, before queuing), so the card shows it at once. */
  async queued(action: DemoAction): Promise<void> {
    await this.state({ action, step: 'queued', outcome: null });
  }

  private async ended(
    action: DemoAction,
    result: DemoOutcome['result'],
    blockers?: Record<string, number>,
  ): Promise<void> {
    await this.state({
      action,
      step: null,
      outcome: { action, result, at: new Date().toISOString(), ...(blockers ? { blockers } : {}) },
    });
  }

  private async state(s: DemoJobState): Promise<void> {
    await this.safe((r) => r.set(DEMO_JOB_KEY, JSON.stringify(s), 'EX', JOB_KEY_TTL_S));
  }

  private async examIds(batchId: string): Promise<string[]> {
    const rows = await this.deps.prisma.exam.findMany({
      where: { demoBatchId: batchId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * What the demo rows were cached in: the exams' configs and the published list, the announcement pages (a new
   * generation), the admin stats. Leaderboard pages are keyed by exam id: a removed exam's are never asked for again.
   */
  private async invalidate(examIds: readonly string[]): Promise<void> {
    await this.safe((r) =>
      r.del(examKeys.published, STATS_KEY, ...examIds.map((id) => examKeys.config(id))),
    );
    await this.safe((r) => r.incr(GENERATION_KEY));
  }

  private async safe<T>(fn: (r: Redis) => Promise<T>): Promise<T | null> {
    const r = this.deps.cache;
    if (!r || r.status !== 'ready') return null;
    return withTimeout(fn(r), REDIS_TIMEOUT_MS).catch(() => null);
  }
}

/** demo_clear's named errors, from the Postgres message Prisma passes on. */
export function clearRefusal(e: unknown): DemoClearBlocked | DemoClearBusy | null {
  const text = e instanceof Error ? e.message : String(e);
  if (text.includes('demo_clear_busy')) return new DemoClearBusy();
  const m = /demo_clear_blocked: (\{[^}]*\})/.exec(text);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]!) as Record<string, unknown>;
    return new DemoClearBlocked(
      Object.fromEntries(
        Object.entries(parsed).filter((kv): kv is [string, number] => typeof kv[1] === 'number'),
      ),
    );
  } catch {
    return new DemoClearBlocked({});
  }
}
