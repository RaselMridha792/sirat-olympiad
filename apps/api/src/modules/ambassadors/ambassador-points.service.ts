import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AmbassadorPointsConfig,
  AmbassadorPointsUpdate,
  PointsAdjustRequest,
  PointsAdjustResult,
  RankThresholdInput,
} from '@sirat/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AmbassadorLeaderboardService } from './ambassador-leaderboard.service';
import type { Actor } from './ambassadors.service';
import { POINTS_PER_REFERRAL_KEY, pointsPerReferral } from './referral-points';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Points settings and adjustments (core C5b, CORE-PLAN §6; owner Q3 defaults until answered). Admins only. Points are
 * a ledger: an adjustment is a new compensating row, never an edit. The settings are one resource (points per referral
 * and the rank thresholds) with a single writer: the admin sends the values they saw, a change in between is 409.
 */
@Injectable()
export class AmbassadorPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: AmbassadorLeaderboardService,
  ) {}

  async get(actorId: string): Promise<AmbassadorPointsConfig> {
    await assertAdmin(this.prisma, actorId);
    return readConfig(this.prisma);
  }

  async update(body: AmbassadorPointsUpdate, actor: Actor): Promise<AmbassadorPointsConfig> {
    await assertAdmin(this.prisma, actor.id);
    const next: AmbassadorPointsConfig = {
      pointsPerReferral: body.pointsPerReferral,
      thresholds: body.thresholds.map((t) => ({ name: t.name, minPoints: t.minPoints })),
    };
    if (!validThresholds(next.thresholds)) throw new BadRequestException(['bad_thresholds']);
    const saved = await this.prisma.$transaction(async (tx) => {
      // One writer at a time, even while the settings row does not exist yet; released at commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('core.ambassador_points'))`;
      const current = await readConfig(tx);
      if (!sameConfig(current, body.expected)) throw new ConflictException(['stale']);
      await tx.setting.upsert({
        where: { key: POINTS_PER_REFERRAL_KEY },
        create: { key: POINTS_PER_REFERRAL_KEY, value: next.pointsPerReferral },
        update: { value: next.pointsPerReferral },
      });
      // Names and minimums are both UNIQUE, so a reorder cannot be done row by row: the table is replaced. Nothing
      // references a threshold; ranks are read from it on demand.
      await tx.rankThreshold.deleteMany({});
      await tx.rankThreshold.createMany({ data: next.thresholds });
      await tx.auditLog.create({
        data: {
          action: 'ambassador_points.changed',
          actorId: actor.id,
          entityType: 'settings',
          entityId: POINTS_PER_REFERRAL_KEY,
          ip: actor.ip,
          meta: { before: toJson(current), after: toJson(next), reason: body.reason },
        },
      });
      return next;
    });
    await this.leaderboard.invalidate(); // the tiers on the leaderboard follow the thresholds
    return saved;
  }

  async adjust(body: PointsAdjustRequest, actor: Actor): Promise<PointsAdjustResult> {
    await assertAdmin(this.prisma, actor.id);
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: body.userId },
        select: { id: true, ambassador: { select: { userId: true } } },
      });
      if (!user) throw new NotFoundException('User not found');
      if (!user.ambassador) throw new ConflictException(['not_ambassador']);
      await tx.pointLedger.create({
        data: {
          userId: user.id,
          eventKey: `adjust:${randomUUID()}`,
          amount: body.amount,
          reason: body.reason,
          createdById: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'points.adjusted',
          actorId: actor.id,
          entityType: 'user',
          entityId: user.id,
          ip: actor.ip,
          meta: { amount: body.amount, reason: body.reason },
        },
      });
      const sum = await tx.pointLedger.aggregate({
        where: { userId: user.id },
        _sum: { amount: true },
      });
      return { userId: user.id, points: sum._sum.amount ?? 0 };
    });
    await this.leaderboard.invalidate();
    return result;
  }
}

async function readConfig(db: Db): Promise<AmbassadorPointsConfig> {
  const [points, thresholds] = await Promise.all([
    pointsPerReferral(db),
    db.rankThreshold.findMany({
      orderBy: { minPoints: 'asc' },
      select: { name: true, minPoints: true },
    }),
  ]);
  return { pointsPerReferral: points, thresholds };
}

/** The first starts at 0, minimums rise strictly, names are distinct in any letter case. */
export function validThresholds(list: readonly RankThresholdInput[]): boolean {
  if (list.length === 0 || list[0]!.minPoints !== 0) return false;
  const names = new Set(list.map((t) => t.name.toLowerCase()));
  if (names.size !== list.length) return false;
  return list.every((t, i) => i === 0 || t.minPoints > list[i - 1]!.minPoints);
}

function sameConfig(a: AmbassadorPointsConfig, b: AmbassadorPointsConfig): boolean {
  return (
    a.pointsPerReferral === b.pointsPerReferral &&
    a.thresholds.length === b.thresholds.length &&
    a.thresholds.every(
      (t, i) => t.name === b.thresholds[i]!.name && t.minPoints === b.thresholds[i]!.minPoints,
    )
  );
}

const toJson = (c: AmbassadorPointsConfig): Prisma.InputJsonValue => ({
  pointsPerReferral: c.pointsPerReferral,
  thresholds: c.thresholds.map((t) => ({ name: t.name, minPoints: t.minPoints })),
});

/** Roles come from the token (15 min); every admin call re-reads them, so a demoted or blocked admin stops at once. */
async function assertAdmin(db: Db, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true },
  });
  if (!user || user.role !== 'admin' || user.isBlocked)
    throw new ForbiddenException('Forbidden resource');
}
