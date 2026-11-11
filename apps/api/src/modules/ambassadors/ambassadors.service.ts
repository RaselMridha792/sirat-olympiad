import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminAmbassadorRow,
  AmbassadorOverview,
  AmbassadorRefusal,
  AmbassadorState,
  Paginated,
} from '@sirat/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AmbassadorLeaderboardService } from './ambassador-leaderboard.service';
import type { AdminAmbassadorQueryDto } from './dto/ambassador.dto';
import { newPromoCode } from './promo-code';
import { type Rank, rankOf } from './rank';

export interface Actor {
  id: string;
  ip: string | null;
}

type Tx = Prisma.TransactionClient;

const DEFAULT_PAGE_SIZE = 20;
const RECENT_REFERRALS = 5;
const TASKS_ON_PANEL = 20;
/** A new code that collides with an existing one makes the whole approval run again (a P2002 aborts the transaction). */
const CODE_TRIES = 3;
const STUDENT_ROLES = ['student', 'ambassador'] as const;

const refuse = (...codes: AmbassadorRefusal[]) => new ConflictException(codes);
const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Ambassadors (core C5a; owner Q2 default: an admin makes a paid student an ambassador, the server assigns the code).
 * Attribution only: a code changes no fee and no payment amount. Payments' registration accepts a code exactly while
 * `approved_at` is set; revoking clears it and keeps the row, so the code is never given to anyone else. Referral
 * counts and points are derived from rows (RULEBOOK §19), never stored.
 */
@Injectable()
export class AmbassadorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: AmbassadorLeaderboardService,
  ) {}

  async approve(userId: string, reason: string, actor: Actor): Promise<AmbassadorState> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const approved = await this.prisma.$transaction((tx) =>
          this.approveOnce(tx, userId, reason, actor),
        );
        await this.leaderboard.invalidate();
        return approved;
      } catch (e) {
        if (isUniqueViolation(e) && attempt < CODE_TRIES) continue; // a code collision: draw again
        throw e;
      }
    }
  }

  private async approveOnce(
    tx: Tx,
    userId: string,
    reason: string,
    actor: Actor,
  ): Promise<AmbassadorState> {
    await assertAdmin(tx, actor.id);
    const user = await lockUser(tx, userId);
    if (!(STUDENT_ROLES as readonly string[]).includes(user.role)) throw refuse('wrong_role');
    if (user.isBlocked) throw refuse('blocked');
    // A registration exists only for a paid payment (payments' trigger): read only.
    if (!(await tx.registration.findUnique({ where: { userId }, select: { id: true } })))
      throw refuse('not_paid_student');
    const profile = await tx.ambassadorProfile.findUnique({ where: { userId } });
    if (profile?.approvedAt && user.role === 'ambassador')
      return state(userId, profile.promoCode, profile.approvedAt, 'ambassador'); // already: nothing changes
    const now = new Date();
    const saved = profile
      ? await tx.ambassadorProfile.update({ where: { userId }, data: { approvedAt: now } })
      : await tx.ambassadorProfile.create({
          data: { userId, promoCode: newPromoCode(), approvedAt: now },
        });
    await tx.user.update({ where: { id: userId }, data: { role: 'ambassador' } });
    await audit(tx, actor, 'ambassador.approved', userId, {
      promoCode: saved.promoCode,
      reapproved: Boolean(profile),
      reason,
    });
    return state(userId, saved.promoCode, saved.approvedAt, 'ambassador');
  }

  async revoke(userId: string, reason: string, actor: Actor): Promise<AmbassadorState> {
    const revoked = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      const user = await lockUser(tx, userId);
      const profile = await tx.ambassadorProfile.findUnique({ where: { userId } });
      if (!profile?.approvedAt) throw refuse('not_ambassador');
      await tx.ambassadorProfile.update({ where: { userId }, data: { approvedAt: null } });
      const role = user.role === 'ambassador' ? 'student' : user.role;
      if (role !== user.role) await tx.user.update({ where: { id: userId }, data: { role } });
      await audit(tx, actor, 'ambassador.revoked', userId, {
        promoCode: profile.promoCode,
        reason,
      });
      return state(userId, profile.promoCode, null, role);
    });
    await this.leaderboard.invalidate();
    return revoked;
  }

  async list(query: AdminAmbassadorQueryDto, actor: Actor): Promise<Paginated<AdminAmbassadorRow>> {
    await assertAdmin(this.prisma, actor.id);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.AmbassadorProfileWhereInput = {
      ...(query.status === 'approved' ? { approvedAt: { not: null } } : {}),
      ...(query.status === 'revoked' ? { approvedAt: null } : {}),
      ...(query.q
        ? {
            OR: [
              { promoCode: { equals: query.q, mode: 'insensitive' } },
              { user: { name: { contains: query.q, mode: 'insensitive' } } },
              { user: { email: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const include = { user: { select: { name: true, email: true, demoBatchId: true } } } as const;
    const [total, profiles] =
      query.sort === 'points'
        ? await this.byPoints(where, page, pageSize, include)
        : await this.prisma.$transaction([
            this.prisma.ambassadorProfile.count({ where }),
            this.prisma.ambassadorProfile.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              skip: (page - 1) * pageSize,
              take: pageSize,
              include,
            }),
          ]);
    const ids = profiles.map((p) => p.userId);
    const [referrals, points, thresholds] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['referredById'],
        where: { referredById: { in: ids } },
        _count: true,
      }),
      this.prisma.pointLedger.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _sum: { amount: true },
      }),
      this.thresholds(),
    ]);
    const referralsOf = new Map(referrals.map((r) => [r.referredById, r._count]));
    const pointsOf = new Map(points.map((p) => [p.userId, p._sum.amount ?? 0]));
    return {
      items: profiles.map((p) => {
        const total = pointsOf.get(p.userId) ?? 0;
        return {
          userId: p.userId,
          name: p.user.name,
          email: p.user.email,
          promoCode: p.promoCode,
          approvedAt: p.approvedAt?.toISOString() ?? null,
          createdAt: p.createdAt.toISOString(),
          referralCount: referralsOf.get(p.userId) ?? 0,
          points: total,
          rankName: rankOf(total, thresholds).current?.name ?? null,
          demo: p.user.demoBatchId !== null,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  /**
   * The admin list by points (`sort=points`): the most points first, ties newest first. Points are the ledger's sum,
   * not a column, so the matching profiles (an ambassador list: hundreds at most) are ranked here, then one page of
   * them is read.
   */
  private async byPoints<I extends Prisma.AmbassadorProfileInclude>(
    where: Prisma.AmbassadorProfileWhereInput,
    page: number,
    pageSize: number,
    include: I,
  ) {
    const all = await this.prisma.ambassadorProfile.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { userId: true },
    });
    const sums = await this.prisma.pointLedger.groupBy({
      by: ['userId'],
      where: { userId: { in: all.map((p) => p.userId) } },
      _sum: { amount: true },
    });
    const pointsOf = new Map(sums.map((s) => [s.userId, s._sum.amount ?? 0]));
    // Array.prototype.sort is stable: equal points keep the newest-first order.
    const ids = all
      .map((p) => p.userId)
      .sort((a, b) => (pointsOf.get(b) ?? 0) - (pointsOf.get(a) ?? 0))
      .slice((page - 1) * pageSize, page * pageSize);
    const rows = await this.prisma.ambassadorProfile.findMany({
      where: { userId: { in: ids } },
      include,
    });
    const position = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => position.get(a.userId)! - position.get(b.userId)!);
    return [all.length, rows] as const;
  }

  /** The ambassador's own panel: their code, referrals (no contact details), points and rank. */
  async me(userId: string): Promise<AmbassadorOverview> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isBlocked: true, ambassador: true },
    });
    if (!user || user.isBlocked) throw new ForbiddenException(['account_blocked']);
    if (user.role !== 'ambassador') throw new ForbiddenException('Forbidden resource'); // revoked since login
    const profile = user.ambassador;
    const [referralCount, sum, thresholds, recent, assignments, membership] = await Promise.all([
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.pointLedger.aggregate({ where: { userId }, _sum: { amount: true } }),
      this.thresholds(),
      this.prisma.user.findMany({
        where: { referredById: userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_REFERRALS,
        select: { name: true, institution: true, createdAt: true },
      }),
      // Own assignments of tasks that are not archived (C5b-2); the proof itself is not sent back.
      this.prisma.taskAssignment.findMany({
        where: { userId, task: { archivedAt: null } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: TASKS_ON_PANEL,
        select: {
          id: true,
          status: true,
          reviewNote: true,
          submittedAt: true,
          task: { select: { title: true, description: true, points: true } },
        },
      }),
      this.prisma.teamMember.findUnique({
        where: { userId },
        select: {
          team: {
            select: { id: true, name: true, ownerId: true, _count: { select: { members: true } } },
          },
        },
      }),
    ]);
    const points = sum._sum.amount ?? 0;
    return {
      promoCode: profile?.approvedAt ? profile.promoCode : null,
      approvedAt: profile?.approvedAt?.toISOString() ?? null,
      referralCount,
      points,
      rank: rankOf(points, thresholds),
      team: membership
        ? {
            id: membership.team.id,
            name: membership.team.name,
            memberCount: membership.team._count.members,
            isOwner: membership.team.ownerId === userId,
          }
        : null,
      tasks: assignments.map((a) => ({
        id: a.id,
        title: a.task.title,
        description: a.task.description,
        points: a.task.points,
        status: a.status,
        reviewNote: a.reviewNote,
        submittedAt: a.submittedAt?.toISOString() ?? null,
      })),
      recentReferrals: recent.map((r) => ({
        name: r.name,
        institution: r.institution,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  private thresholds(): Promise<Rank[]> {
    return this.prisma.rankThreshold.findMany({
      orderBy: { minPoints: 'asc' },
      select: { name: true, minPoints: true },
    });
  }
}

const state = (
  userId: string,
  promoCode: string,
  approvedAt: Date | null,
  role: AmbassadorState['role'],
): AmbassadorState => ({ userId, promoCode, approvedAt: approvedAt?.toISOString() ?? null, role });

/** Roles come from the token (15 min); every admin call re-reads them, so a demoted or blocked admin stops at once. */
async function assertAdmin(db: Tx | PrismaService, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true },
  });
  if (!user || user.role !== 'admin' || user.isBlocked)
    throw new ForbiddenException('Forbidden resource');
}

/** Locks the student's row for the rest of the transaction: two approvals never race. */
async function lockUser(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true },
  });
  if (!user) throw new NotFoundException('User not found');
  return user;
}

function audit(tx: Tx, actor: Actor, action: string, userId: string, meta: Prisma.InputJsonValue) {
  return tx.auditLog.create({
    data: { action, actorId: actor.id, entityType: 'user', entityId: userId, ip: actor.ip, meta },
  });
}
