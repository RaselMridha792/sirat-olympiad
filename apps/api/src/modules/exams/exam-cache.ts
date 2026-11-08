import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Category, ExamStatus } from '@sirat/shared';
import type Redis from 'ioredis';
import { withTimeout } from '../../common/with-timeout';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CACHE } from '../../redis/redis.module';
import type { QuestionVersion } from '../attempts/layout';

/** What the exam path needs about an exam, as cached. Times are ISO strings. */
export interface ExamConfig {
  id: string;
  title: string;
  status: ExamStatus;
  category: Category | null;
  roundId: string | null;
  windowStart: string;
  windowEnd: string;
  durationMinutes: number;
  questionsPerAttempt: number;
  graceSeconds: number;
  randomDraw: boolean;
  contentVersion: number;
  resultsPublishedAt: string | null;
  /** A demo exam (DECISIONS 2026-11-08 "Demo data"): only demo accounts see and start it. Missing in a config cached
   * before this field existed, which counts as a real exam. */
  demo?: boolean;
}

const CONFIG_TTL_S = 60;
const POOL_TTL_S = 3 * 24 * 3600;
const VERSION_TTL_S = 3 * 24 * 3600;
const REDIS_TIMEOUT_MS = 300;
const LOCK_MS = 3_000;
const WAIT_STEPS = 3;
const WAIT_STEP_MS = 100;
const WARN_EVERY_MS = 30_000;

/** Exported for the demo data's invalidation (demo-runner.ts). */
export const keys = {
  config: (id: string) => `exam:cfg:${id}`,
  published: 'exam:published',
  pool: (id: string, cv: number) => `exam:pool:${id}:${cv}`,
  poolLock: (id: string, cv: number) => `exam:lock:pool:${id}:${cv}`,
  version: (id: string) => `exam:qv:${id}`,
};

const configSelect = {
  id: true,
  title: true,
  status: true,
  category: true,
  roundId: true,
  windowStart: true,
  windowEnd: true,
  durationMinutes: true,
  questionsPerAttempt: true,
  graceSeconds: true,
  randomDraw: true,
  contentVersion: true,
  resultsPublishedAt: true,
  demoBatchId: true,
} as const;

/**
 * The exam path's read cache in the cache Redis (EXAM-PLAN 2.5, 3.2): exam config, the active pool per content
 * version, and each question version's text and options. It NEVER holds a correct key or an explanation (those are
 * read by the worker from Postgres), so nothing that leaks from this cache can reveal an answer. Redis trouble falls
 * back to Postgres; a cold pool is loaded once (a short lock), so a window-open surge cannot stampede the database.
 */
@Injectable()
export class ExamCache {
  private readonly logger = new Logger(ExamCache.name);
  private lastWarnAt = 0;

  constructor(
    @Inject(REDIS_CACHE) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async config(examId: string): Promise<ExamConfig | null> {
    const cached = await this.safe(() => this.redis.get(keys.config(examId)));
    if (cached) return JSON.parse(cached) as ExamConfig;
    const row = await this.prisma.exam.findUnique({ where: { id: examId }, select: configSelect });
    if (!row) return null;
    const config = toConfig(row);
    await this.safe(() =>
      this.redis.set(keys.config(examId), JSON.stringify(config), 'EX', CONFIG_TTL_S),
    );
    return config;
  }

  /** Every published exam (the student list filters by category). */
  async published(): Promise<ExamConfig[]> {
    const cached = await this.safe(() => this.redis.get(keys.published));
    if (cached) return JSON.parse(cached) as ExamConfig[];
    const rows = await this.prisma.exam.findMany({
      where: { status: 'published' },
      select: configSelect,
      orderBy: [{ windowStart: 'asc' }, { id: 'asc' }],
    });
    const list = rows.map(toConfig);
    await this.safe(() => this.redis.set(keys.published, JSON.stringify(list), 'EX', CONFIG_TTL_S));
    return list;
  }

  /**
   * Active question ids of the exam's current content version. Returns the version it actually read, which can be
   * newer than the one asked for (an admin saved a question meanwhile); the attempt insert checks it again.
   */
  async pool(
    examId: string,
    contentVersion: number,
  ): Promise<{ contentVersion: number; ids: string[] }> {
    const key = keys.pool(examId, contentVersion);
    const cached = await this.safe(() => this.redis.get(key));
    if (cached) return { contentVersion, ids: JSON.parse(cached) as string[] };

    const lock = await this.safe(() =>
      this.redis.set(keys.poolLock(examId, contentVersion), '1', 'PX', LOCK_MS, 'NX'),
    );
    if (lock === null) {
      // Someone else holds the lock and is loading it: wait briefly for their copy before going to the database ourselves.
      for (let i = 0; i < WAIT_STEPS; i++) {
        await sleep(WAIT_STEP_MS);
        const ready = await this.safe(() => this.redis.get(key));
        if (ready) return { contentVersion, ids: JSON.parse(ready) as string[] };
      }
    }
    // One statement, one snapshot: the content version and the pool always match.
    const rows = await this.prisma.$queryRaw<{ cv: number; id: string | null }[]>`
      SELECT e."content_version" AS cv, q."id"
      FROM "exams" e
      LEFT JOIN "questions" q ON q."exam_id" = e."id" AND q."is_active"
      WHERE e."id" = ${examId}::uuid
      ORDER BY q."position", q."id"`;
    const cv = rows[0]?.cv ?? contentVersion;
    const ids = rows.flatMap((r) => (r.id ? [r.id] : []));
    await this.safe(() =>
      this.redis.set(keys.pool(examId, cv), JSON.stringify(ids), 'EX', POOL_TTL_S),
    );
    return { contentVersion: cv, ids };
  }

  /** Text and options of the given question versions (immutable once published, so cached for days). */
  async versions(ids: readonly string[]): Promise<Map<string, QuestionVersion>> {
    const out = new Map<string, QuestionVersion>();
    if (ids.length === 0) return out;
    const cached = await this.safe(() => this.redis.mget(...ids.map(keys.version)));
    ids.forEach((id, i) => {
      const hit = cached?.[i];
      if (hit) out.set(id, JSON.parse(hit) as QuestionVersion);
    });
    const missing = ids.filter((id) => !out.has(id));
    if (missing.length === 0) return out;

    // Selected field by field: the correct key and the explanation never leave Postgres on this path.
    const rows = await this.prisma.question.findMany({
      where: { id: { in: missing } },
      select: { id: true, text: true, options: true, keepOptionOrder: true },
    });
    const pipeline = this.redis.pipeline();
    for (const row of rows) {
      const version: QuestionVersion = {
        text: row.text,
        options: (row.options as Array<{ key: string; text: string }>).map((o) => ({
          key: o.key,
          text: o.text,
        })),
        keepOptionOrder: row.keepOptionOrder,
      };
      out.set(row.id, version);
      pipeline.set(keys.version(row.id), JSON.stringify(version), 'EX', VERSION_TTL_S);
    }
    await this.safe(() => pipeline.exec());
    return out;
  }

  /** After an admin write: the config and the published list are re-read (pools are keyed by content version). */
  async invalidateExam(examId: string): Promise<void> {
    await this.safe(() => this.redis.del(keys.config(examId), keys.published));
  }

  /** A draft question edited or deleted in place (only drafts change in place; published versions never do). */
  async invalidateQuestion(questionId: string): Promise<void> {
    await this.safe(() => this.redis.del(keys.version(questionId)));
  }

  /** Loads the pool and its versions ahead of the first start (EXAM-PLAN 3.2). Best effort. */
  async warm(examId: string): Promise<void> {
    await this.invalidateExam(examId);
    const config = await this.config(examId);
    if (!config || config.status !== 'published') return;
    const pool = await this.pool(examId, config.contentVersion);
    await this.versions(pool.ids);
  }

  /**
   * A Redis command with a short timeout. A failure is logged (rate-limited) and answered with undefined, which callers
   * tell apart from Redis's own null (key absent, lock taken).
   */
  private async safe<T>(op: () => Promise<T>): Promise<T | undefined> {
    try {
      return await withTimeout(op(), REDIS_TIMEOUT_MS);
    } catch (e) {
      const now = Date.now();
      if (now - this.lastWarnAt >= WARN_EVERY_MS) {
        this.lastWarnAt = now;
        this.logger.warn({
          msg: 'exam cache unavailable, reading Postgres',
          errName: (e as Error).name,
        });
      }
      return undefined;
    }
  }
}

function toConfig(row: {
  id: string;
  title: string;
  status: ExamStatus;
  category: Category | null;
  roundId: string | null;
  windowStart: Date;
  windowEnd: Date;
  durationMinutes: number;
  questionsPerAttempt: number;
  graceSeconds: number;
  randomDraw: boolean;
  contentVersion: number;
  resultsPublishedAt: Date | null;
  demoBatchId: string | null;
}): ExamConfig {
  const { demoBatchId, ...rest } = row;
  return {
    ...rest,
    windowStart: row.windowStart.toISOString(),
    windowEnd: row.windowEnd.toISOString(),
    resultsPublishedAt: row.resultsPublishedAt?.toISOString() ?? null,
    demo: demoBatchId !== null,
  };
}
