import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_VIDEO_CRITERIA,
  ENTRY_STATUSES,
  ROUND_LIMITS,
  type AdminPromotionRun,
  type AdminRound,
  type EntryStatus,
  type MyRound,
  type RoundCreateRequest,
  type RoundCriterion,
  type RoundUpdateRequest,
} from '@sirat/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { currentRoundOf } from './current-round';

type Tx = Prisma.TransactionClient;
export interface Actor {
  id: string;
  ip: string | null;
}

const conflict = (code: string) => new ConflictException([code]);
const badRequest = (code: string) => new BadRequestException([code]);

const ROUND_SELECT = {
  id: true,
  name: true,
  sortOrder: true,
  type: true,
  opensAt: true,
  closesAt: true,
  criteria: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.RoundSelect;
type RoundRow = Prisma.RoundGetPayload<{ select: typeof ROUND_SELECT }>;

/**
 * Rounds as data (core C6a, CORE-PLAN §7). Round 1 (quiz) exists since A1 and exam's exams link to it. Admins add
 * video and final rounds after it, in order, and set their windows; a video round carries the jury's criteria. The
 * order and the type never change; a window is never shortened once it has opened, and a closed window stays closed.
 */
@Injectable()
export class RoundsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actorId: string): Promise<{ items: AdminRound[] }> {
    await assertAdmin(this.prisma, actorId);
    const rounds = await this.prisma.round.findMany({
      orderBy: { sortOrder: 'asc' },
      select: ROUND_SELECT,
    });
    return { items: await this.decorate(rounds) };
  }

  async get(actorId: string, id: string): Promise<AdminRound> {
    await assertAdmin(this.prisma, actorId);
    const round = await this.prisma.round.findUnique({ where: { id }, select: ROUND_SELECT });
    if (!round) throw new NotFoundException('Round not found');
    const [one] = await this.decorate([round]);
    return one!;
  }

  async create(body: RoundCreateRequest, actor: Actor): Promise<AdminRound> {
    await assertAdmin(this.prisma, actor.id);
    const now = new Date();
    const opensAt = body.opensAt === undefined ? null : new Date(body.opensAt);
    const closesAt = body.closesAt === undefined ? null : new Date(body.closesAt);
    checkWindow(body.type, opensAt, closesAt, now, true);
    let criteria: RoundCriterion[] | null = null;
    if (body.type === 'video')
      criteria = checkCriteria(body.criteria ?? [...DEFAULT_VIDEO_CRITERIA]);
    else if (body.criteria !== undefined) throw badRequest('bad_criteria');

    const id = await this.prisma.$transaction(async (tx) => {
      // One writer at a time: the next sort order is read and used under the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('core:rounds'))`;
      const existing = await tx.round.findMany({ select: { sortOrder: true, type: true } });
      if (existing.some((r) => r.type === 'final')) throw conflict('after_final');
      if (existing.length >= ROUND_LIMITS.maxRounds) throw conflict('too_many_rounds');
      const sortOrder = Math.max(0, ...existing.map((r) => r.sortOrder)) + 1;
      const round = await tx.round.create({
        data: {
          name: body.name,
          type: body.type,
          sortOrder,
          opensAt,
          closesAt,
          criteria: criteria ? (criteria as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        },
        select: { id: true },
      });
      await audit(tx, actor, 'round.created', round.id, { sortOrder, type: body.type });
      return round.id;
    });
    return this.get(actor.id, id);
  }

  async update(id: string, body: RoundUpdateRequest, actor: Actor): Promise<AdminRound> {
    await assertAdmin(this.prisma, actor.id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "rounds" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const round = await tx.round.findUnique({ where: { id }, select: ROUND_SELECT });
      if (!round) throw new NotFoundException('Round not found');
      if (round.updatedAt.toISOString() !== new Date(body.expectedUpdatedAt).toISOString())
        throw conflict('stale');

      const data: Prisma.RoundUpdateInput = {};
      if (body.name !== undefined && body.name !== round.name) data.name = body.name;

      const windowSent = body.opensAt !== undefined || body.closesAt !== undefined;
      if (round.type === 'quiz' && (windowSent || body.criteria !== undefined))
        throw conflict('quiz_round');

      if (body.criteria !== undefined) {
        if (round.type !== 'video') throw conflict('not_video_round');
        const criteria = checkCriteria(body.criteria);
        if (JSON.stringify(criteria) !== JSON.stringify(round.criteria)) {
          if (await scored(tx, id)) throw conflict('criteria_frozen');
          data.criteria = criteria as unknown as Prisma.InputJsonValue;
        }
      }

      if (windowSent) {
        const opensAt = body.opensAt === undefined ? round.opensAt : new Date(body.opensAt);
        const closesAt = body.closesAt === undefined ? round.closesAt : new Date(body.closesAt);
        const opensChanged = !sameTime(opensAt, round.opensAt);
        const closesChanged = !sameTime(closesAt, round.closesAt);
        if (opensChanged && round.opensAt && round.opensAt <= now) throw conflict('window_started');
        if (closesChanged && round.closesAt && round.closesAt <= now)
          throw conflict('window_closed');
        if (
          closesChanged &&
          round.opensAt &&
          round.opensAt <= now &&
          round.closesAt &&
          closesAt &&
          closesAt < round.closesAt
        )
          throw conflict('window_shortened');
        if (opensChanged || closesChanged) {
          checkWindow(round.type, opensAt, closesAt, now, closesChanged);
          if (opensChanged) data.opensAt = opensAt;
          if (closesChanged) data.closesAt = closesAt;
        }
      }

      if (Object.keys(data).length === 0) throw conflict('nothing_to_update');
      await tx.round.update({ where: { id }, data });
      await audit(tx, actor, 'round.updated', id, { fields: Object.keys(data).sort() });
    });
    return this.get(actor.id, id);
  }

  /** GET /rounds/me: the caller's own round and entry; re-read, so a blocked user or a staff token is refused. */
  async mine(userId: string): Promise<MyRound> {
    await assertMember(this.prisma, userId);
    const current = await currentRoundOf(this.prisma, userId);
    if (!current) throw new NotFoundException('No round');
    return current;
  }

  private async decorate(rounds: RoundRow[]): Promise<AdminRound[]> {
    if (rounds.length === 0) return [];
    const ids = rounds.map((r) => r.id);
    const [counts, scoredRows, runs] = await Promise.all([
      this.prisma.roundEntry.groupBy({
        by: ['roundId', 'status'],
        where: { roundId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ round_id: string }>>`
        SELECT DISTINCT e."round_id"::text AS round_id
        FROM "jury_scores" s JOIN "round_entries" e ON e."id" = s."entry_id"
        WHERE e."round_id" = ANY(${ids}::uuid[])`,
      this.prisma.promotionRun.findMany({
        where: { fromRoundId: { in: ids } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const scoredIds = new Set(scoredRows.map((r) => r.round_id));
    return rounds.map((r) => {
      const entries = Object.fromEntries(ENTRY_STATUSES.map((s) => [s, 0])) as Record<
        EntryStatus,
        number
      >;
      for (const c of counts) if (c.roundId === r.id) entries[c.status] = c._count._all;
      const promotions: AdminPromotionRun[] = runs
        .filter((p) => p.fromRoundId === r.id)
        .map((p) => ({
          id: p.id,
          category: p.category,
          toRoundId: p.toRoundId,
          topN: p.topN,
          promoted: p.promotedCount,
          eliminated: p.eliminatedCount,
          createdAt: p.createdAt.toISOString(),
        }));
      return {
        id: r.id,
        name: r.name,
        sortOrder: r.sortOrder,
        type: r.type,
        opensAt: r.opensAt?.toISOString() ?? null,
        closesAt: r.closesAt?.toISOString() ?? null,
        criteria: r.type === 'video' ? ((r.criteria as RoundCriterion[] | null) ?? null) : null,
        scored: scoredIds.has(r.id),
        entries,
        promotions,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }
}

const sameTime = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * A video round needs both ends; a final round has both or neither. The close follows the opening, and a close that
 * is being set lies in the future.
 */
function checkWindow(
  type: string,
  opensAt: Date | null,
  closesAt: Date | null,
  now: Date,
  closesSet: boolean,
): void {
  if (type === 'video' && (!opensAt || !closesAt)) throw badRequest('bad_window');
  if ((opensAt === null) !== (closesAt === null)) throw badRequest('bad_window');
  if (opensAt && closesAt && closesAt <= opensAt) throw badRequest('bad_window');
  if (closesSet && closesAt && closesAt <= now) throw badRequest('bad_window');
}

/** Keys unique; labels already trimmed and bounded by the DTO. Returns a clean copy (only the three fields). */
function checkCriteria(list: readonly RoundCriterion[]): RoundCriterion[] {
  const keys = new Set(list.map((c) => c.key));
  if (keys.size !== list.length) throw badRequest('bad_criteria');
  return list.map((c) => ({ key: c.key, en: c.en, bn: c.bn }));
}

async function scored(tx: Tx, roundId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM "jury_scores" s JOIN "round_entries" e ON e."id" = s."entry_id"
    WHERE e."round_id" = ${roundId}::uuid LIMIT 1`;
  return rows.length > 0;
}

function audit(tx: Tx, actor: Actor, action: string, roundId: string, meta: Prisma.InputJsonValue) {
  return tx.auditLog.create({
    data: { action, actorId: actor.id, entityType: 'round', entityId: roundId, ip: actor.ip, meta },
  });
}

export async function assertAdmin(db: PrismaService | Tx, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true },
  });
  if (!user || user.role !== 'admin' || user.isBlocked)
    throw new ForbiddenException('Forbidden resource');
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
