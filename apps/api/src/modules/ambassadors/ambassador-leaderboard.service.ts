import { randomUUID } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import type { AmbassadorLeaderboard } from '@sirat/shared';
import type Redis from 'ioredis';
import { withTimeout } from '../../common/with-timeout';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CACHE } from '../../redis/redis.module';
import { rankOf } from './rank';

/** The ranking is at most this old; `asOf` says when it was computed. */
export const LEADERBOARD_TTL_S = 60;
export const LEADERBOARD_KEY = 'ambassador-leaderboard:v1';
/** Longer than a computation ever takes; a crashed leader's lock simply expires. */
const LOCK_MS = 10_000;
/** A follower waits this long (in steps) for the leader's result, then computes on its own. */
const WAIT_STEP_MS = 100;
const WAIT_STEPS = 50;
const REDIS_TIMEOUT_MS = 300;
const DEFAULT_PAGE_SIZE = 20;
/** Deletes the lock only if this request still holds it. */
const RELEASE =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

type Side = 'real' | 'demo';
const keyOf = (side: Side) => `${LEADERBOARD_KEY}:${side}`;

/** One ranked ambassador as cached: the id stays on the server, it only marks the caller's own row. */
interface Ranked {
  userId: string;
  rank: number;
  name: string;
  institution: string | null;
  points: number;
  tier: string | null;
}
interface Ranking {
  asOf: string;
  rows: Ranked[];
}

/**
 * The ambassador leaderboard (core A4; 06-API "Ambassadors"; the lead's approval of 2026-11-10). Approved, unblocked
 * ambassadors of the viewer's side (demo data never ranks with real), by their points (the ledger's sum); equal
 * points share a rank (1, 2, 2, 4). The name and institution as the exam board shows them, the points and the tier;
 * no id, contact, code or referral list. The ranking of each side is cached for 60 s in the cache Redis with a
 * single-flight lock (as the admin stats), and core's own ledger and membership writes drop it at once
 * (`invalidate`); the referral sweep's new points show within the minute. Redis trouble only means the ranking is
 * read from Postgres on every call.
 */
@Injectable()
export class AmbassadorLeaderboardService {
  private readonly logger = new Logger(AmbassadorLeaderboardService.name);
  private lastWarnAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  /** GET /ambassador/leaderboard: the caller is re-read, so a revoked or blocked ambassador stops at once. */
  async page(
    userId: string,
    q: { page?: number; pageSize?: number },
  ): Promise<AmbassadorLeaderboard> {
    const viewer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isBlocked: true, demoBatchId: true },
    });
    if (!viewer || viewer.isBlocked) throw new ForbiddenException(['account_blocked']);
    if (viewer.role !== 'ambassador') throw new ForbiddenException('Forbidden resource'); // revoked since login
    const ranking = await this.ranking(viewer.demoBatchId === null ? 'real' : 'demo');
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;
    const mine = ranking.rows.find((r) => r.userId === userId);
    return {
      items: ranking.rows.slice((page - 1) * pageSize, page * pageSize).map((r) => ({
        rank: r.rank,
        name: r.name,
        institution: r.institution,
        points: r.points,
        tier: r.tier,
        isMe: r.userId === userId,
      })),
      page,
      pageSize,
      total: ranking.rows.length,
      me: mine ? { rank: mine.rank, points: mine.points } : null,
      asOf: ranking.asOf,
    };
  }

  /** Drops both sides' cached ranking (after a ledger or membership write). Best effort: the TTL bounds the rest. */
  async invalidate(): Promise<void> {
    await this.safe(() => this.redis.del(keyOf('real'), keyOf('demo')));
  }

  private async ranking(side: Side): Promise<Ranking> {
    const key = keyOf(side);
    const cached = await this.cached(key);
    if (cached) return cached;
    const lockKey = `${key}:lock`;
    const token = randomUUID();
    const lock = await this.safe(() => this.redis.set(lockKey, token, 'PX', LOCK_MS, 'NX'));
    if (lock === undefined) return this.compute(side); // no Redis: no cache, no lock
    if (lock === null) {
      // Another request is computing: take its result when it lands, or compute after a short wait.
      for (let i = 0; i < WAIT_STEPS; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
        const landed = await this.cached(key);
        if (landed) return landed;
      }
      return this.compute(side);
    }
    try {
      const landed = await this.cached(key);
      if (landed) return landed;
      const ranking = await this.compute(side);
      await this.safe(() => this.redis.set(key, JSON.stringify(ranking), 'EX', LEADERBOARD_TTL_S));
      return ranking;
    } finally {
      await this.safe(() => this.redis.eval(RELEASE, 1, lockKey, token));
    }
  }

  /** One statement: every approved, unblocked ambassador of the side with the ledger's sum, ranked. */
  async compute(side: Side): Promise<Ranking> {
    const [rows, thresholds] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          user_id: string;
          name: string;
          institution: string | null;
          points: number;
          rank: number;
        }>
      >`
        SELECT u."id"::text AS user_id, u."name", u."institution", t."points"::int AS points,
               (rank() OVER (ORDER BY t."points" DESC))::int AS rank
        FROM "ambassador_profiles" p
        JOIN "users" u ON u."id" = p."user_id"
        CROSS JOIN LATERAL (
          SELECT coalesce(sum(l."amount"), 0) AS points FROM "point_ledger" l WHERE l."user_id" = u."id"
        ) t
        WHERE p."approved_at" IS NOT NULL AND u."role"::text = 'ambassador' AND u."is_blocked" = false
          AND (u."demo_batch_id" IS NULL) = ${side === 'real'}
        ORDER BY t."points" DESC, u."name" ASC, u."id" ASC`,
      this.prisma.rankThreshold.findMany({
        orderBy: { minPoints: 'asc' },
        select: { name: true, minPoints: true },
      }),
    ]);
    return {
      asOf: new Date().toISOString(),
      rows: rows.map((r) => ({
        userId: r.user_id,
        rank: r.rank,
        name: r.name,
        institution: r.institution,
        points: r.points,
        tier: rankOf(r.points, thresholds).current?.name ?? null,
      })),
    };
  }

  private async cached(key: string): Promise<Ranking | null> {
    const raw = await this.safe(() => this.redis.get(key));
    return raw ? (JSON.parse(raw) as Ranking) : null;
  }

  private async safe<T>(op: () => Promise<T>): Promise<T | undefined> {
    try {
      return await withTimeout(op(), REDIS_TIMEOUT_MS);
    } catch (e) {
      const now = Date.now();
      if (now - this.lastWarnAt >= 30_000) {
        this.lastWarnAt = now;
        this.logger.warn({
          msg: 'ambassador leaderboard cache unavailable, reading Postgres',
          errName: (e as Error).name,
        });
      }
      return undefined;
    }
  }
}
