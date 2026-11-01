import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  TEAM_LIMITS,
  type AdminTeamDetail,
  type AdminTeamRow,
  type MyTeam,
  type Paginated,
  type TeamRenameRequest,
} from '@sirat/shared';
import type Redis from 'ioredis';
import { withTimeout } from '../../common/with-timeout';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CACHE } from '../../redis/redis.module';
import type { Actor } from './ambassadors.service';
import { newJoinCode } from './promo-code';

type Tx = Prisma.TransactionClient;
type PageParams = { page?: number; pageSize?: number; q?: string };
const DEFAULT_PAGE_SIZE = 20;
const CODE_TRIES = 3;
const JOIN_WINDOW_MS = 10 * 60_000;
const REDIS_TIMEOUT_MS = 300;
const conflict = (code: string) => new ConflictException([code]);

const isUnique = (e: unknown, field: string) =>
  e instanceof Prisma.PrismaClientKnownRequestError &&
  e.code === 'P2002' &&
  JSON.stringify(e.meta?.target ?? '').includes(field);

/** First name only: members are minors (lead). */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/**
 * Ambassador teams (core C5b-3, CORE-PLAN D7; lead's plan and rules). One team per ambassador, one team per student,
 * at most 10 members (the owner included), joined with the team's code. Members see each other's first names only.
 * A team whose owner is no longer an approved ambassador takes no new members; its members keep it. Admins list,
 * read and rename teams (moderation, with a reason); there is no dissolve in v1.
 */
@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);
  private lastWarnAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  // ───────────── Ambassador and student ─────────────

  async create(name: string, actor: Actor): Promise<MyTeam> {
    await assertActiveAmbassador(this.prisma, actor.id);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          if (await tx.team.findUnique({ where: { ownerId: actor.id }, select: { id: true } }))
            throw conflict('already_has_team');
          if (
            await tx.teamMember.findUnique({
              where: { userId: actor.id },
              select: { teamId: true },
            })
          )
            throw conflict('already_in_team');
          const team = await tx.team.create({
            data: { name, joinCode: newJoinCode(), ownerId: actor.id },
          });
          await tx.teamMember.create({ data: { teamId: team.id, userId: actor.id } });
          await audit(tx, actor, 'team.created', team.id, {});
          return myTeam(tx, team.id, actor.id);
        });
      } catch (e) {
        if (isUnique(e, 'name')) throw conflict('name_taken');
        if (isUnique(e, 'owner_id')) throw conflict('already_has_team');
        if (isUnique(e, 'user_id')) throw conflict('already_in_team');
        // A join code that collides aborts the transaction (P2002), so the whole creation runs again.
        if (isUnique(e, 'join_code') && attempt < CODE_TRIES) continue;
        throw e;
      }
    }
  }

  async mine(userId: string): Promise<MyTeam> {
    await assertMember(this.prisma, userId);
    const membership = await this.prisma.teamMember.findUnique({
      where: { userId },
      select: { teamId: true },
    });
    if (!membership) throw new NotFoundException('Not in a team');
    return myTeam(this.prisma, membership.teamId, userId);
  }

  /**
   * Every attempt counts toward the per-IP limit before anything is looked up, so a refused code (404) or a full or
   * closed team (409) costs the same as a success: guessing a 6-character code stays slow. The per-user limit is
   * the route's own throttle tier.
   */
  async join(code: string, actor: Actor): Promise<MyTeam> {
    await this.countIpAttempt(actor.ip);
    await assertMember(this.prisma, actor.id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const found = await tx.team.findUnique({ where: { joinCode: code }, select: { id: true } });
        if (!found) throw new NotFoundException('Team not found');
        await tx.$queryRaw`SELECT 1 FROM "teams" WHERE "id" = ${found.id}::uuid FOR UPDATE`;
        const team = await tx.team.findUniqueOrThrow({
          where: { id: found.id },
          select: {
            id: true,
            owner: {
              select: { role: true, isBlocked: true, ambassador: { select: { approvedAt: true } } },
            },
            _count: { select: { members: true } },
          },
        });
        if (!ownerActive(team.owner)) throw conflict('team_closed');
        if (
          await tx.teamMember.findUnique({ where: { userId: actor.id }, select: { teamId: true } })
        )
          throw conflict('already_in_team');
        if (team._count.members >= TEAM_LIMITS.maxMembers) throw conflict('team_full');
        await tx.teamMember.create({ data: { teamId: team.id, userId: actor.id } });
        await audit(tx, actor, 'team.joined', team.id, {});
        return myTeam(tx, team.id, actor.id);
      });
    } catch (e) {
      if (isUnique(e, 'user_id')) throw conflict('already_in_team');
      throw e;
    }
  }

  async leave(actor: Actor): Promise<void> {
    await assertMember(this.prisma, actor.id);
    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.teamMember.findUnique({
        where: { userId: actor.id },
        select: { teamId: true, team: { select: { ownerId: true } } },
      });
      if (!membership) throw conflict('not_in_team');
      if (membership.team.ownerId === actor.id) throw conflict('owner_cannot_leave');
      await tx.teamMember.delete({
        where: { teamId_userId: { teamId: membership.teamId, userId: actor.id } },
      });
      await audit(tx, actor, 'team.left', membership.teamId, {});
    });
  }

  // ───────────── Admin ─────────────

  async list(actorId: string, q: PageParams): Promise<Paginated<AdminTeamRow>> {
    await assertAdmin(this.prisma, actorId);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.TeamWhereInput = q.q
      ? { name: { contains: q.q, mode: 'insensitive' } }
      : {};
    const [total, rows] = await Promise.all([
      this.prisma.team.count({ where }),
      this.prisma.team.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: TEAM_ROW_SELECT,
      }),
    ]);
    return { items: rows.map(toAdminRow), page, pageSize, total };
  }

  async get(actorId: string, id: string): Promise<AdminTeamDetail> {
    await assertAdmin(this.prisma, actorId);
    const team = await this.prisma.team.findUnique({
      where: { id },
      select: {
        ...TEAM_ROW_SELECT,
        members: {
          orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
          select: { createdAt: true, user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    return {
      ...toAdminRow(team),
      members: team.members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        joinedAt: m.createdAt.toISOString(),
      })),
    };
  }

  async rename(id: string, body: TeamRenameRequest, actor: Actor): Promise<AdminTeamRow> {
    await assertAdmin(this.prisma, actor.id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "teams" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const team = await tx.team.findUnique({
          where: { id },
          select: { name: true, updatedAt: true },
        });
        if (!team) throw new NotFoundException('Team not found');
        if (team.updatedAt.toISOString() !== new Date(body.expectedUpdatedAt).toISOString())
          throw conflict('stale');
        if (team.name === body.name) throw conflict('nothing_to_update');
        await tx.team.update({ where: { id }, data: { name: body.name } });
        // The names are a minor's free text: the audit row keeps the reason, not the names.
        await audit(tx, actor, 'team.renamed', id, { reason: body.reason });
        const row = await tx.team.findUniqueOrThrow({ where: { id }, select: TEAM_ROW_SELECT });
        return toAdminRow(row);
      });
    } catch (e) {
      if (isUnique(e, 'name')) throw conflict('name_taken');
      throw e;
    }
  }

  // ───────────── Limits ─────────────

  /** A fixed 10-minute window per IP in the cache Redis; Redis trouble lets the attempt through (the throttler too). */
  private async countIpAttempt(ip: string | null): Promise<void> {
    if (!ip) return;
    const key = `teams:join:ip:${ip}`;
    try {
      const count = await withTimeout(this.redis.incr(key), REDIS_TIMEOUT_MS);
      if (count === 1) await withTimeout(this.redis.pexpire(key, JOIN_WINDOW_MS), REDIS_TIMEOUT_MS);
      if (count > TEAM_LIMITS.joinsPerIp)
        throw new HttpException(
          'Too many join attempts. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
    } catch (e) {
      if (e instanceof HttpException) throw e;
      const now = Date.now();
      if (now - this.lastWarnAt >= 30_000) {
        this.lastWarnAt = now;
        this.logger.warn({ msg: 'team join limiter unavailable', errName: (e as Error).name });
      }
    }
  }
}

const TEAM_ROW_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  owner: {
    select: {
      id: true,
      name: true,
      role: true,
      isBlocked: true,
      ambassador: { select: { approvedAt: true } },
    },
  },
  _count: { select: { members: true } },
} satisfies Prisma.TeamSelect;

type TeamRowData = Prisma.TeamGetPayload<{ select: typeof TEAM_ROW_SELECT }>;

function toAdminRow(t: TeamRowData): AdminTeamRow {
  return {
    id: t.id,
    name: t.name,
    owner: { userId: t.owner.id, name: t.owner.name },
    open: ownerActive(t.owner),
    memberCount: t._count.members,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function ownerActive(owner: {
  role: string;
  isBlocked: boolean;
  ambassador: { approvedAt: Date | null } | null;
}): boolean {
  return owner.role === 'ambassador' && !owner.isBlocked && Boolean(owner.ambassador?.approvedAt);
}

async function myTeam(db: Tx | PrismaService, teamId: string, userId: string): Promise<MyTeam> {
  const team = await db.team.findUniqueOrThrow({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      joinCode: true,
      ownerId: true,
      members: {
        orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
        select: { userId: true, user: { select: { name: true } } },
      },
    },
  });
  const isOwner = team.ownerId === userId;
  return {
    id: team.id,
    name: team.name,
    memberCount: team.members.length,
    isOwner,
    joinCode: isOwner ? team.joinCode : null,
    members: team.members.map((m) => ({
      firstName: firstName(m.user.name),
      isOwner: m.userId === team.ownerId,
    })),
  };
}

function audit(tx: Tx, actor: Actor, action: string, teamId: string, meta: Prisma.InputJsonValue) {
  return tx.auditLog.create({
    data: { action, actorId: actor.id, entityType: 'team', entityId: teamId, ip: actor.ip, meta },
  });
}

/** A student or an ambassador who is not blocked, re-read (the token's role may be older). */
async function assertMember(db: PrismaService, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true },
  });
  if (!user || user.isBlocked || (user.role !== 'student' && user.role !== 'ambassador'))
    throw new ForbiddenException('Forbidden resource');
}

async function assertActiveAmbassador(db: PrismaService, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true, ambassador: { select: { approvedAt: true } } },
  });
  if (!user || !ownerActive(user)) throw new ForbiddenException('Forbidden resource');
}

async function assertAdmin(db: PrismaService, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true },
  });
  if (!user || user.role !== 'admin' || user.isBlocked)
    throw new ForbiddenException('Forbidden resource');
}
