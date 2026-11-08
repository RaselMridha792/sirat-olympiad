import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Category,
  PromotionPreview,
  PromotionQuery,
  PromotionRequest,
  PromotionResult,
} from '@sirat/shared';
import { uuidv7 } from '../../common/uuidv7';
import { PrismaService } from '../../prisma/prisma.service';
import { assertAdmin, type Actor } from './rounds.service';

type Tx = Prisma.TransactionClient;
const conflict = (code: string) => new ConflictException([code]);

type RoundInfo = { id: string; name: string; type: 'quiz' | 'video' | 'final' };

interface Plan {
  from: RoundInfo;
  to: RoundInfo;
  source:
    { kind: 'exam'; examId: string; examTitle: string; generation: number } | { kind: 'jury' };
  candidates: number;
  promoted: number;
  cut: PromotionPreview['cut'];
  sourceKey: string;
}

interface Counts {
  candidates: number;
  promoted: number;
  cut_rank: number | null;
  cut_score: number | null;
  cut_time: number | null;
}

/**
 * Promotion (core C6a, CORE-PLAN §7; lead's review). Moves the top N of one category from a round to the next:
 * - from a quiz round: the category's rows of its exam's **published** snapshot, ranked inside the category by
 *   exam's order (score, then time; equal score and time share a rank);
 * - from a video round: the entries' jury averages, after the window closed and with every video scored.
 * Everyone at rank ≤ N goes through, ties at the cut included (owner Q4a default). One run per (round, category),
 * one transaction: the run row, the next round's entries (`ON CONFLICT DO NOTHING`, never overwriting), the source
 * round's entries marked promoted or eliminated (Round 1's are created here), and an audit row with counts only.
 */
@Injectable()
export class PromotionService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(roundId: string, q: PromotionQuery, actorId: string): Promise<PromotionPreview> {
    await assertAdmin(this.prisma, actorId);
    const plan = await this.prisma.$transaction((tx) => this.plan(tx, roundId, q), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    return toPreview(plan, q);
  }

  async run(roundId: string, body: PromotionRequest, actor: Actor): Promise<PromotionResult> {
    await assertAdmin(this.prisma, actor.id);
    return this.prisma.$transaction(
      async (tx) => {
        // One promotion out of a round at a time; video submissions and scores (C6b) take the same lock.
        await tx.$queryRaw`SELECT 1 FROM "rounds" WHERE "id" = ${roundId}::uuid FOR UPDATE`;
        const plan = await this.plan(tx, roundId, body);
        if (plan.sourceKey !== body.expected.sourceKey || plan.promoted !== body.expected.promoted)
          throw conflict('stale');
        if (plan.promoted === 0) throw conflict('no_entries');
        const eliminated = plan.candidates - plan.promoted;
        const runId = uuidv7();
        await tx.promotionRun.create({
          data: {
            id: runId,
            fromRoundId: plan.from.id,
            toRoundId: plan.to.id,
            category: body.category,
            topN: body.topN,
            sourceKind: plan.source.kind,
            sourceExamId: plan.source.kind === 'exam' ? plan.source.examId : null,
            sourceGeneration: plan.source.kind === 'exam' ? plan.source.generation : null,
            promotedCount: plan.promoted,
            eliminatedCount: eliminated,
            createdById: actor.id,
          },
        });
        if (plan.source.kind === 'exam') await promoteFromExam(tx, plan.source, plan, body, runId);
        else await promoteFromJury(tx, plan, body, runId);
        await tx.auditLog.create({
          data: {
            action: 'round.promoted',
            actorId: actor.id,
            entityType: 'round',
            entityId: plan.from.id,
            ip: actor.ip,
            meta: {
              runId,
              toRoundId: plan.to.id,
              category: body.category,
              topN: body.topN,
              promoted: plan.promoted,
              eliminated,
              source: plan.source.kind,
            },
          },
        });
        return {
          runId,
          promoted: plan.promoted,
          eliminated,
          toRound: { id: plan.to.id, name: plan.to.name },
        };
      },
      { timeout: 60_000 },
    );
  }

  /** The checks and the counts; the preview and the run share it, so the run promotes exactly what was previewed. */
  private async plan(tx: Tx, roundId: string, q: PromotionQuery): Promise<Plan> {
    const from = await tx.round.findUnique({
      where: { id: roundId },
      select: { id: true, name: true, type: true, sortOrder: true, closesAt: true },
    });
    if (!from) throw new NotFoundException('Round not found');
    // Demo rounds follow Round 1 (demo data): a real promotion would move real students into them, and the demo
    // promotions are the loader's own. None runs while demo rounds exist; the admin removes the demo data first.
    if (await tx.round.count({ where: { demoBatchId: { not: null } } }))
      throw conflict('demo_rounds_present');
    const done = await tx.promotionRun.findUnique({
      where: { fromRoundId_category: { fromRoundId: from.id, category: q.category } },
      select: { id: true },
    });
    if (done) throw conflict('already_promoted');
    // The next real round: a real promotion never moves anyone into a demo round.
    const to = await tx.round.findFirst({
      where: { sortOrder: { gt: from.sortOrder }, demoBatchId: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, type: true },
    });
    if (from.type === 'final' || !to) throw conflict('no_next_round');
    const info = { id: from.id, name: from.name, type: from.type };

    if (from.type === 'quiz') {
      const exams = await tx.exam.findMany({
        where: {
          roundId: from.id,
          // An archived exam is retired: never a promotion source. Nor is a demo exam on the real Round 1 (demo data):
          // a real promotion moves real students only.
          status: 'published',
          demoBatchId: null,
          OR: [{ category: q.category }, { category: null }],
        },
        select: { id: true, title: true, resultsPublishedAt: true, resultsGeneration: true },
        take: 2,
      });
      if (exams.length === 0) throw conflict('no_exam');
      if (exams.length > 1) throw conflict('ambiguous_source');
      const exam = exams[0]!;
      if (!exam.resultsPublishedAt || exam.resultsGeneration < 1)
        throw conflict('results_not_published');
      const [c] = await tx.$queryRaw<Counts[]>`
        WITH ranked AS (${examRanked(exam.id, exam.resultsGeneration, q.category)}),
             cut AS (SELECT max("r") AS "r" FROM ranked WHERE "r" <= ${q.topN})
        SELECT (SELECT count(*) FROM ranked)::int AS candidates,
               (SELECT count(*) FROM ranked WHERE "r" <= ${q.topN})::int AS promoted,
               (SELECT "r" FROM cut)::int AS cut_rank,
               (SELECT "score" FROM ranked WHERE "r" = (SELECT "r" FROM cut) LIMIT 1)::int AS cut_score,
               (SELECT "time_taken_seconds" FROM ranked WHERE "r" = (SELECT "r" FROM cut) LIMIT 1)::int
                 AS cut_time`;
      return {
        from: info,
        to,
        source: {
          kind: 'exam',
          examId: exam.id,
          examTitle: exam.title,
          generation: exam.resultsGeneration,
        },
        ...counted(c!),
        sourceKey: `exam:${exam.id}:${exam.resultsGeneration}`,
      };
    }

    // A video round: after the close, with every sent video scored.
    if (!from.closesAt || from.closesAt > new Date()) throw conflict('window_not_closed');
    const [unscored] = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM "round_entries" e JOIN "users" u ON u."id" = e."user_id"
      WHERE e."round_id" = ${from.id}::uuid AND u."category" = ${q.category}::"Category"
        AND e."status"::text = 'submitted'`;
    if (unscored!.n > 0) throw conflict('unscored_entries');
    const [c] = await tx.$queryRaw<Array<Counts & { key: string | null }>>`
      WITH ranked AS (${juryRanked(from.id, q.category)}),
           cut AS (SELECT max("r") AS "r" FROM ranked WHERE "r" <= ${q.topN})
      SELECT (SELECT count(*) FROM "round_entries" e JOIN "users" u ON u."id" = e."user_id"
               WHERE e."round_id" = ${from.id}::uuid AND u."category" = ${q.category}::"Category")::int
               AS candidates,
             (SELECT count(*) FROM ranked WHERE "r" <= ${q.topN})::int AS promoted,
             (SELECT "r" FROM cut)::int AS cut_rank,
             (SELECT "score" FROM ranked WHERE "r" = (SELECT "r" FROM cut) LIMIT 1)::float8 AS cut_score,
             NULL::int AS cut_time,
             (SELECT md5(string_agg(e."id"::text || ':' || e."status"::text || ':' || coalesce(e."score"::text, '-'),
                                    ',' ORDER BY e."id"))
               FROM "round_entries" e JOIN "users" u ON u."id" = e."user_id"
               WHERE e."round_id" = ${from.id}::uuid AND u."category" = ${q.category}::"Category") AS key`;
    return {
      from: info,
      to,
      source: { kind: 'jury' },
      ...counted(c!),
      sourceKey: `jury:${c!.key ?? 'none'}`,
    };
  }
}

/** The category's rows of one snapshot, ranked inside the category in exam's order. */
const examRanked = (examId: string, generation: number, category: Category) => Prisma.sql`
  SELECT le."user_id", le."score", le."time_taken_seconds",
         rank() OVER (ORDER BY le."score" DESC, le."time_taken_seconds" ASC) AS "r"
  FROM "leaderboard_entries" le
  WHERE le."exam_id" = ${examId}::uuid AND le."generation" = ${generation}
    AND le."category" = ${category}::"Category"`;

/** A video round's scored entries of one category, ranked by the jury average (equal averages share a rank). */
const juryRanked = (roundId: string, category: Category) => Prisma.sql`
  SELECT e."id", e."user_id", e."score", rank() OVER (ORDER BY e."score" DESC) AS "r"
  FROM "round_entries" e JOIN "users" u ON u."id" = e."user_id"
  WHERE e."round_id" = ${roundId}::uuid AND u."category" = ${category}::"Category"
    AND e."status"::text = 'evaluated' AND e."score" IS NOT NULL`;

function counted(c: Counts): Pick<Plan, 'candidates' | 'promoted' | 'cut'> {
  return {
    candidates: c.candidates,
    promoted: c.promoted,
    cut:
      c.cut_rank === null
        ? null
        : { rank: c.cut_rank, score: Number(c.cut_score), timeTakenSeconds: c.cut_time },
  };
}

function toPreview(plan: Plan, q: PromotionQuery): PromotionPreview {
  return {
    from: plan.from,
    to: plan.to,
    category: q.category,
    topN: q.topN,
    source: plan.source,
    candidates: plan.candidates,
    promoted: plan.promoted,
    tieCount: Math.max(0, plan.promoted - q.topN),
    eliminated: plan.candidates - plan.promoted,
    cut: plan.cut,
    expected: { promoted: plan.promoted, sourceKey: plan.sourceKey },
  };
}

async function promoteFromExam(
  tx: Tx,
  source: { examId: string; generation: number },
  plan: Plan,
  q: PromotionQuery,
  runId: string,
): Promise<void> {
  const ranked = examRanked(source.examId, source.generation, q.category);
  await tx.$executeRaw`
    WITH ranked AS (${ranked})
    INSERT INTO "round_entries" ("id", "user_id", "round_id", "promotion_run_id")
    SELECT gen_random_uuid(), "user_id", ${plan.to.id}::uuid, ${runId}::uuid FROM ranked WHERE "r" <= ${q.topN}
    ON CONFLICT ("user_id", "round_id") DO NOTHING`;
  // Round 1 had no entries: everyone on the snapshot gets one now, so the home can show "promoted" or "eliminated".
  await tx.$executeRaw`
    WITH ranked AS (${ranked})
    INSERT INTO "round_entries" ("id", "user_id", "round_id", "status")
    SELECT gen_random_uuid(), "user_id", ${plan.from.id}::uuid,
           (CASE WHEN "r" <= ${q.topN} THEN 'promoted' ELSE 'eliminated' END)::"EntryStatus"
    FROM ranked
    ON CONFLICT ("user_id", "round_id") DO NOTHING`;
}

async function promoteFromJury(
  tx: Tx,
  plan: Plan,
  q: PromotionQuery,
  runId: string,
): Promise<void> {
  const ranked = juryRanked(plan.from.id, q.category);
  await tx.$executeRaw`
    WITH ranked AS (${ranked})
    INSERT INTO "round_entries" ("id", "user_id", "round_id", "promotion_run_id")
    SELECT gen_random_uuid(), "user_id", ${plan.to.id}::uuid, ${runId}::uuid FROM ranked WHERE "r" <= ${q.topN}
    ON CONFLICT ("user_id", "round_id") DO NOTHING`;
  // Only the status changes: the video and the score stay as they are. An entry without a video is eliminated.
  await tx.$executeRaw`
    WITH ranked AS (${ranked})
    UPDATE "round_entries" e
    SET "status" = (CASE WHEN e."id" IN (SELECT "id" FROM ranked WHERE "r" <= ${q.topN})
                         THEN 'promoted' ELSE 'eliminated' END)::"EntryStatus",
        "updated_at" = now()
    FROM "users" u
    WHERE u."id" = e."user_id" AND e."round_id" = ${plan.from.id}::uuid
      AND u."category" = ${q.category}::"Category"`;
}
