import { randomUUID } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CATEGORIES,
  REGISTRATION_ATTEMPT_STATUSES,
  STATS_PAYMENT_STATUSES,
  type AdminStats,
} from '@sirat/shared';
import type Redis from 'ioredis';
import { withTimeout } from '../../common/with-timeout';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CACHE } from '../../redis/redis.module';

/** The admin home is at most this old; `asOf` says when it was computed. */
export const STATS_TTL_S = 60;
export const STATS_KEY = 'admin-stats:v1';
const LOCK_KEY = `${STATS_KEY}:lock`;
/** Longer than a computation ever takes; a crashed leader's lock simply expires. */
const LOCK_MS = 10_000;
/** A follower waits this long (in steps) for the leader's result, then computes on its own. */
const WAIT_STEP_MS = 100;
const WAIT_STEPS = 50;
const REDIS_TIMEOUT_MS = 300;
const DAYS = 45;
const DHAKA_OFFSET_MS = 6 * 3_600_000; // Asia/Dhaka is UTC+6 all year (no daylight saving)
/** Deletes the lock only if this request still holds it. */
const RELEASE =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const STAFF = new Set(['admin', 'manager']);

/**
 * The admin home's counts (06-API "Admin statistics"; lead 2026-11-01). Reads payments' and exam's tables, writes
 * none. All counts come from one REPEATABLE READ snapshot, so they agree with each other. The result is cached for
 * 60 s in the cache Redis with a single-flight lock: a burst of admins runs the queries once. Redis trouble only
 * means the counts are read from Postgres on every call.
 */
@Injectable()
export class AdminStatsService {
  private readonly logger = new Logger(AdminStatsService.name);
  private lastWarnAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  async get(actorId: string): Promise<AdminStats> {
    await this.assertStaff(actorId);
    const cached = await this.cached();
    if (cached) return cached;
    const token = randomUUID();
    const lock = await this.safe(() => this.redis.set(LOCK_KEY, token, 'PX', LOCK_MS, 'NX'));
    if (lock === undefined) return this.compute(); // no Redis: no cache, no lock
    if (lock === null) {
      // Another request is computing: take its result when it lands, or compute after a short wait.
      for (let i = 0; i < WAIT_STEPS; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
        const landed = await this.cached();
        if (landed) return landed;
      }
      return this.compute();
    }
    try {
      // A leader may have written the result and released the lock between our miss and our lock: look again, so
      // a request that arrives late in a burst never computes a second time.
      const landed = await this.cached();
      if (landed) return landed;
      const stats = await this.compute();
      await this.safe(() => this.redis.set(STATS_KEY, JSON.stringify(stats), 'EX', STATS_TTL_S));
      return stats;
    } finally {
      await this.safe(() => this.redis.eval(RELEASE, 1, LOCK_KEY, token));
    }
  }

  /** Roles come from the token (15 min): every call re-reads them, so a demoted or blocked user stops at once. */
  private async assertStaff(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isBlocked: true },
    });
    if (!user || !STAFF.has(user.role) || user.isBlocked)
      throw new ForbiddenException('Forbidden resource');
  }

  private async cached(): Promise<AdminStats | null> {
    const raw = await this.safe(() => this.redis.get(STATS_KEY));
    return raw ? (JSON.parse(raw) as AdminStats) : null;
  }

  async compute(now: Date = new Date()): Promise<AdminStats> {
    const { start, days } = dhakaDays(now);
    const [
      registered,
      payments,
      review,
      attempts,
      examAttempts,
      categories,
      approved,
      revoked,
      referred,
      daily,
    ] = await this.prisma.$transaction(
      [
        this.prisma.registration.count(),
        this.prisma.payment.groupBy({
          by: ['status'],
          orderBy: { status: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.payment.count({ where: { reviewReason: { not: null } } }),
        this.prisma.pendingRegistration.groupBy({
          by: ['status'],
          orderBy: { status: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.attempt.groupBy({
          by: ['status'],
          orderBy: { status: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.user.groupBy({
          by: ['category'],
          where: { role: { in: ['student', 'ambassador'] }, category: { not: null } },
          orderBy: { category: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.ambassadorProfile.count({ where: { approvedAt: { not: null } } }),
        this.prisma.ambassadorProfile.count({ where: { approvedAt: null } }),
        this.prisma.user.count({ where: { referredById: { not: null } } }),
        this.prisma.$queryRaw<{ day: string; count: number }[]>`
          SELECT to_char(("created_at" AT TIME ZONE 'Asia/Dhaka')::date, 'YYYY-MM-DD') AS "day",
                 count(*)::int AS "count"
          FROM "registrations"
          WHERE "created_at" >= ${start}
          GROUP BY 1`,
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const byStatus = <K extends string>(
      keys: readonly K[],
      rows: ReadonlyArray<Grouped & { status: string }>,
    ) =>
      Object.fromEntries(
        keys.map((key) => [key, countOf(rows.find((r) => r.status === key))]),
      ) as Record<K, number>;
    const paymentsByStatus = byStatus(STATS_PAYMENT_STATUSES, payments);
    const exam = byStatus(['in_progress', 'submitted', 'expired', 'scored'] as const, examAttempts);
    const perDay = new Map(daily.map((d) => [d.day, d.count]));
    return {
      asOf: now.toISOString(),
      totals: {
        registered,
        paid: paymentsByStatus.paid,
        pendingPayments: paymentsByStatus.initiated + paymentsByStatus.pending,
        activeAttempts: exam.in_progress,
        submittedAttempts: exam.submitted + exam.expired + exam.scored,
        secondRound: null,
        finalists: null,
      },
      registrationsDaily: days.map((date) => ({ date, count: perDay.get(date) ?? 0 })),
      byCategory: CATEGORIES.map((category) => ({
        category,
        count: countOf(categories.find((c) => c.category === category)),
      })),
      registrationAttempts: byStatus(REGISTRATION_ATTEMPT_STATUSES, attempts),
      paymentsByStatus,
      paymentsNeedingReview: review,
      ambassadors: { approved, revoked, referredStudents: referred },
    };
  }

  private async safe<T>(op: () => Promise<T>): Promise<T | undefined> {
    try {
      return await withTimeout(op(), REDIS_TIMEOUT_MS);
    } catch (e) {
      const now = Date.now();
      if (now - this.lastWarnAt >= 30_000) {
        this.lastWarnAt = now;
        this.logger.warn({
          msg: 'admin stats cache unavailable, reading Postgres',
          errName: (e as Error).name,
        });
      }
      return undefined;
    }
  }
}

/** A groupBy row (Prisma types `_count` loosely inside a batch transaction). */
type Grouped = { _count?: true | { _all?: number } };
const countOf = (row: Grouped | undefined): number =>
  row && typeof row._count === 'object' ? (row._count._all ?? 0) : 0;

/** The last 45 Asia/Dhaka calendar days, oldest first, and the instant the first one began. */
export function dhakaDays(now: Date): { start: Date; days: string[] } {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const days = Array.from({ length: DAYS }, (_, i) =>
    new Date(today - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
  return { start: new Date(today - (DAYS - 1) * 86_400_000 - DHAKA_OFFSET_MS), days };
}
