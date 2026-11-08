import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Category } from '@prisma/client';
import {
  JURY_LIMITS,
  ROUND_LIMITS,
  type AdminRoundJury,
  type JuryAssignResult,
  type JuryEntryQuery,
  type JuryEntryRow,
  type JuryRound,
  type JuryScoreRequest,
  type JuryScoreResult,
  type Paginated,
  type RoundCriterion,
} from '@sirat/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { assertAdmin, type Actor } from './rounds.service';

type Tx = Prisma.TransactionClient;
const conflict = (code: string) => new ConflictException([code]);
const DEFAULT_PAGE_SIZE = 20;
/** "E-" and the last 8 hex digits of the entry id (the random part of a UUIDv7): a number to talk about, no name. */
const ENTRY_CODE = Prisma.sql`'E-' || upper(right(replace(e."id"::text, '-', ''), 8))`;
/**
 * Demo data never mixes with real data (DECISIONS 2026-11-08 "Demo data"): a demo judge sees and scores only demo
 * accounts' entries, a real judge only real ones; to the other side an entry does not exist. `u` is the entry's user.
 */
const sameSide = (judgeIsDemo: boolean) =>
  judgeIsDemo ? Prisma.sql`u."demo_batch_id" IS NOT NULL` : Prisma.sql`u."demo_batch_id" IS NULL`;

/**
 * The jury of a video round (core C6b, CORE-PLAN §7; lead's notes, Q4c/Q4d defaults).
 * - Admins assign jury-role accounts to a video round per category.
 * - A judge sees the sent videos of their categories after the window closed, **blind**: an entry number, the
 *   category and the link, never a name, institution or contact.
 * - A score covers every criterion of the round (0–10); its total is out of 100 (the sum times 10 over the number
 *   of criteria). `jury_scores` is append-only: scoring again adds a row. The entry's score is the average of each
 *   judge's latest total among the judges assigned now, recomputed under the entry's row lock, with the round's share lock against a promotion.
 * - Scoring stops once the round's category is promoted. The comment stays with the judges (never the student).
 */
@Injectable()
export class JuryService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────── Admin ─────────────

  async roundJury(actorId: string, roundId: string): Promise<AdminRoundJury> {
    await assertAdmin(this.prisma, actorId);
    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      select: { id: true, name: true, demoBatchId: true },
    });
    if (!round) throw new NotFoundException('Round not found');
    const demo = round.demoBatchId !== null;
    const [assignments, candidates] = await Promise.all([
      this.prisma.juryAssignment.findMany({
        where: { roundId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          category: true,
          createdAt: true,
          judge: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.user.findMany({
        // Only judges of the round's side can be added (demo data).
        where: { role: 'jury', isBlocked: false, demoBatchId: demo ? { not: null } : null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: JURY_LIMITS.candidatesMax,
        select: { id: true, name: true, email: true },
      }),
    ]);
    return {
      round: { id: round.id, name: round.name, demo },
      assignments: assignments.map((a) => ({
        id: a.id,
        judge: { userId: a.judge.id, name: a.judge.name, email: a.judge.email },
        category: a.category,
        createdAt: a.createdAt.toISOString(),
      })),
      candidates: candidates.map((c) => ({ userId: c.id, name: c.name, email: c.email })),
    };
  }

  async assign(
    roundId: string,
    body: { judgeId: string; categories: Category[] },
    actor: Actor,
  ): Promise<JuryAssignResult> {
    await assertAdmin(this.prisma, actor.id);
    return this.prisma.$transaction(async (tx) => {
      const round = await tx.round.findUnique({
        where: { id: roundId },
        select: { type: true, demoBatchId: true },
      });
      if (!round) throw new NotFoundException('Round not found');
      if (round.type !== 'video') throw conflict('not_video_round');
      const judge = await tx.user.findUnique({
        where: { id: body.judgeId },
        select: { role: true, isBlocked: true, demoBatchId: true },
      });
      if (!judge || judge.role !== 'jury' || judge.isBlocked) throw conflict('not_jury');
      // Demo data never mixes with real data: a demo judge only on a demo round, a real judge only on a real one.
      if ((round.demoBatchId === null) !== (judge.demoBatchId === null))
        throw conflict('jury_side_mismatch');
      const made = await tx.juryAssignment.createMany({
        data: body.categories.map((category) => ({
          roundId,
          judgeId: body.judgeId,
          category,
          createdById: actor.id,
        })),
        skipDuplicates: true,
      });
      await audit(tx, actor, 'jury.assigned', roundId, {
        judgeId: body.judgeId,
        categories: body.categories,
        assigned: made.count,
      });
      return { assigned: made.count, alreadyAssigned: body.categories.length - made.count };
    });
  }

  async unassign(roundId: string, assignmentId: string, actor: Actor): Promise<void> {
    await assertAdmin(this.prisma, actor.id);
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.juryAssignment.findFirst({
        where: { id: assignmentId, roundId },
        select: { judgeId: true, category: true },
      });
      if (!found) throw new NotFoundException('Assignment not found');
      // The round's share lock first, as a score takes it (a promotion takes FOR UPDATE), then each entry's lock.
      await tx.$queryRaw`SELECT 1 FROM "rounds" WHERE "id" = ${roundId}::uuid FOR SHARE`;
      await tx.juryAssignment.delete({ where: { id: assignmentId } });
      // The judge's scores stay (jury_scores is append-only) but stop counting: unassigning is the admin's remedy
      // for a wrong judge (lead's review of #75). Every entry of this category the judge scored is recomputed now.
      const touched = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT DISTINCT e."id"::text AS id
        FROM "jury_scores" s
        JOIN "round_entries" e ON e."id" = s."entry_id"
        JOIN "users" u ON u."id" = e."user_id"
        WHERE e."round_id" = ${roundId}::uuid AND s."judge_id" = ${found.judgeId}::uuid
          AND u."category"::text = ${found.category} AND e."status"::text IN ('submitted', 'evaluated')
        ORDER BY 1`;
      for (const { id } of touched) {
        await tx.$queryRaw`SELECT 1 FROM "round_entries" WHERE "id" = ${id}::uuid FOR UPDATE`;
        await recompute(tx, id);
      }
      await audit(tx, actor, 'jury.unassigned', roundId, {
        judgeId: found.judgeId,
        category: found.category,
        recomputed: touched.length,
      });
    });
  }

  // ───────────── Judge ─────────────

  async rounds(judgeId: string): Promise<JuryRound[]> {
    const judge = await assertJury(this.prisma, judgeId);
    const assignments = await this.prisma.juryAssignment.findMany({
      where: { judgeId, round: { type: 'video', demoBatchId: judge.demo ? { not: null } : null } },
      select: {
        category: true,
        round: {
          select: { id: true, name: true, sortOrder: true, closesAt: true, criteria: true },
        },
      },
    });
    const byRound = new Map<
      string,
      { round: (typeof assignments)[number]['round']; categories: Category[] }
    >();
    for (const a of assignments) {
      const item = byRound.get(a.round.id) ?? { round: a.round, categories: [] };
      item.categories.push(a.category);
      byRound.set(a.round.id, item);
    }
    const now = new Date();
    const items = [...byRound.values()].sort((a, b) => a.round.sortOrder - b.round.sortOrder);
    return Promise.all(
      items.map(async ({ round, categories }) => {
        const [c] = await this.prisma.$queryRaw<Array<{ pending: number; evaluated: number }>>`
          SELECT count(*) FILTER (WHERE NOT s.scored)::int AS pending,
                 count(*) FILTER (WHERE s.scored)::int AS evaluated
          FROM (
            SELECT EXISTS (SELECT 1 FROM "jury_scores" j WHERE j."entry_id" = e."id" AND j."judge_id" = ${judgeId}::uuid) AS scored,
                   e."status"::text AS status
            FROM "round_entries" e JOIN "users" u ON u."id" = e."user_id"
            WHERE e."round_id" = ${round.id}::uuid AND e."video_url" IS NOT NULL
              AND u."category"::text = ANY(${categories as string[]}::text[]) AND ${sameSide(judge.demo)}
          ) s
          WHERE s.scored OR s.status IN ('submitted', 'evaluated')`;
        return {
          id: round.id,
          name: round.name,
          closesAt: round.closesAt?.toISOString() ?? null,
          scoringOpen: round.closesAt !== null && round.closesAt <= now,
          criteria: (round.criteria as RoundCriterion[] | null) ?? [],
          categories: [...categories].sort(),
          pending: c?.pending ?? 0,
          evaluated: c?.evaluated ?? 0,
        };
      }),
    );
  }

  async entries(
    judgeId: string,
    q: Pick<JuryEntryQuery, 'round' | 'status'> & { page?: number; pageSize?: number },
  ): Promise<Paginated<JuryEntryRow>> {
    const judge = await assertJury(this.prisma, judgeId);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;
    const status = q.status ?? 'pending';
    const round = await this.prisma.round.findUnique({
      where: { id: q.round },
      select: { type: true, closesAt: true, demoBatchId: true },
    });
    const categories = (
      await this.prisma.juryAssignment.findMany({
        where: { judgeId, roundId: q.round },
        select: { category: true },
      })
    ).map((a) => a.category as string);
    // Not this judge's round, or the other side (demo data): the same answer as a round that does not exist.
    if (
      !round ||
      round.type !== 'video' ||
      categories.length === 0 ||
      (round.demoBatchId !== null) !== judge.demo
    )
      throw new NotFoundException('Round not found');
    if (!round.closesAt || round.closesAt > new Date()) throw conflict('window_open');

    const mine = Prisma.sql`EXISTS (SELECT 1 FROM "jury_scores" j WHERE j."entry_id" = e."id" AND j."judge_id" = ${judgeId}::uuid)`;
    // Pending: sent videos not scored by this judge, while the category is open. Evaluated: scored by this judge.
    const which =
      status === 'pending'
        ? Prisma.sql`NOT ${mine} AND e."status"::text IN ('submitted', 'evaluated')`
        : mine;
    const where = Prisma.sql`e."round_id" = ${q.round}::uuid AND e."video_url" IS NOT NULL
      AND u."category"::text = ANY(${categories}::text[]) AND ${sameSide(judge.demo)} AND ${which}`;
    const [counted] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM "round_entries" e JOIN "users" u ON u."id" = e."user_id" WHERE ${where}`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        category: Category;
        video_url: string;
        video_submitted_at: Date;
        criteria: Record<string, number> | null;
        total: string | null;
        comment: string | null;
        scored_at: Date | null;
      }>
    >`
      SELECT e."id"::text AS id, ${ENTRY_CODE} AS code, u."category" AS category, e."video_url",
             e."video_submitted_at", s."criteria", s."total"::text AS total, s."comment", s."created_at" AS scored_at
      FROM "round_entries" e
      JOIN "users" u ON u."id" = e."user_id"
      LEFT JOIN LATERAL (
        SELECT j."criteria", j."total", j."comment", j."created_at" FROM "jury_scores" j
        WHERE j."entry_id" = e."id" AND j."judge_id" = ${judgeId}::uuid
        ORDER BY j."created_at" DESC, j."id" DESC LIMIT 1
      ) s ON true
      WHERE ${where}
      ORDER BY e."video_submitted_at" ASC, e."id" ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    return {
      items: rows.map((r) => ({
        entryId: r.id,
        code: r.code,
        category: r.category,
        videoUrl: r.video_url,
        videoSubmittedAt: r.video_submitted_at.toISOString(),
        myScore:
          r.total === null || r.scored_at === null
            ? null
            : {
                criteria: r.criteria ?? {},
                total: Number(r.total),
                comment: r.comment,
                scoredAt: r.scored_at.toISOString(),
              },
      })),
      page,
      pageSize,
      total: counted?.n ?? 0,
    };
  }

  async score(entryId: string, body: JuryScoreRequest, actor: Actor): Promise<JuryScoreResult> {
    const judge = await assertJury(this.prisma, actor.id);
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.roundEntry.findUnique({
        where: { id: entryId },
        select: { roundId: true },
      });
      if (!found) throw new NotFoundException('Entry not found');
      // The round's share lock first (a promotion takes it FOR UPDATE), then the entry's row lock.
      const [round] = await tx.$queryRaw<
        Array<{ type: string; closes_at: Date | null; criteria: RoundCriterion[] | null }>
      >`SELECT "type"::text AS type, "closes_at", "criteria" FROM "rounds" WHERE "id" = ${found.roundId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT 1 FROM "round_entries" WHERE "id" = ${entryId}::uuid FOR UPDATE`;
      const entry = await tx.roundEntry.findUniqueOrThrow({
        where: { id: entryId },
        select: {
          status: true,
          videoUrl: true,
          user: { select: { category: true, demoBatchId: true } },
        },
      });
      const category = entry.user.category;
      const assigned =
        category !== null &&
        (await tx.juryAssignment.findUnique({
          where: {
            roundId_judgeId_category: { roundId: found.roundId, judgeId: actor.id, category },
          },
          select: { id: true },
        }));
      // Not a video round, not this judge's category, no video, or the other side (demo data): not an entry this
      // judge can see.
      if (
        !round ||
        round.type !== 'video' ||
        !assigned ||
        entry.videoUrl === null ||
        (entry.user.demoBatchId !== null) !== judge.demo
      )
        throw new NotFoundException('Entry not found');
      if (!round.closes_at || round.closes_at > new Date()) throw conflict('window_open');
      const promoted = await tx.promotionRun.findUnique({
        where: { fromRoundId_category: { fromRoundId: found.roundId, category: category! } },
        select: { id: true },
      });
      if (promoted || (entry.status !== 'submitted' && entry.status !== 'evaluated'))
        throw conflict('already_promoted');

      const keys = (round.criteria ?? []).map((c) => c.key);
      const given = Object.keys(body.criteria);
      const valid =
        keys.length > 0 &&
        given.length === keys.length &&
        keys.every((k) => {
          const v = body.criteria[k];
          return Number.isInteger(v) && v! >= 0 && v! <= ROUND_LIMITS.criterionMax;
        });
      if (!valid) throw new BadRequestException(['bad_scores']);
      const sum = keys.reduce((total, k) => total + body.criteria[k]!, 0);
      // Out of 100 whatever the number of criteria: with the default ten, the plain sum.
      const total =
        Math.round(((sum * 100) / (ROUND_LIMITS.criterionMax * keys.length)) * 100) / 100;

      await tx.juryScore.create({
        data: {
          entryId,
          judgeId: actor.id,
          criteria: Object.fromEntries(keys.map((k) => [k, body.criteria[k]!])),
          total,
          comment: body.comment ?? null,
        },
      });
      const { score, judges } = await recompute(tx, entryId);
      // Ids only: the comment is the judges' own record, never in the audit log.
      await audit(tx, actor, 'jury.scored', found.roundId, { entryId });
      return { entryId, total, score: score ?? 0, judges };
    });
  }
}

/**
 * The entry's score from the judges **assigned now** to its round and category: the average of each one's latest
 * total (lead's review of #75: an unassigned judge's scores stay in the history but stop counting). With no such
 * score left, the entry is back to `submitted` with no score. The caller holds the entry's row lock.
 */
async function recompute(
  tx: Tx,
  entryId: string,
): Promise<{ score: number | null; judges: number }> {
  const [avg] = await tx.$queryRaw<Array<{ score: string | null; judges: number }>>`
    SELECT round(avg(t."total"), 2)::text AS score, count(*)::int AS judges FROM (
      SELECT DISTINCT ON (s."judge_id") s."total"
      FROM "jury_scores" s
      JOIN "round_entries" e ON e."id" = s."entry_id"
      JOIN "users" u ON u."id" = e."user_id"
      JOIN "jury_assignments" a
        ON a."round_id" = e."round_id" AND a."judge_id" = s."judge_id" AND a."category" = u."category"
      WHERE s."entry_id" = ${entryId}::uuid
      ORDER BY s."judge_id", s."created_at" DESC, s."id" DESC
    ) t`;
  const judges = avg?.judges ?? 0;
  const score = judges > 0 && avg?.score ? avg.score : null;
  await tx.roundEntry.update({
    where: { id: entryId },
    data:
      score === null
        ? { score: null, status: 'submitted' }
        : { score: new Prisma.Decimal(score), status: 'evaluated' },
  });
  return { score: score === null ? null : Number(score), judges };
}

function audit(tx: Tx, actor: Actor, action: string, roundId: string, meta: Prisma.InputJsonValue) {
  return tx.auditLog.create({
    data: { action, actorId: actor.id, entityType: 'round', entityId: roundId, ip: actor.ip, meta },
  });
}

/** A jury-role account that is not blocked, re-read (the token's role may be older); `demo` is its side. */
async function assertJury(db: PrismaService, userId: string): Promise<{ demo: boolean }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true, demoBatchId: true },
  });
  if (!user || user.role !== 'jury' || user.isBlocked)
    throw new ForbiddenException('Forbidden resource');
  return { demo: user.demoBatchId !== null };
}
