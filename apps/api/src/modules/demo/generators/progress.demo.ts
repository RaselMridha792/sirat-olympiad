import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { CATEGORIES, DEFAULT_VIDEO_CRITERIA, type Category } from '@sirat/shared';
import type { DemoContext, DemoGenerator } from '../demo.types';

const DAY = 86_400_000;
/** Of each category's Round 1 field, this share goes through to the video round (ties at the cut go too). */
const ROUND1_SHARE = 0.4;
/** Of the promoted, this share sent a video. */
const VIDEO_SHARE = 0.8;
/** Per category into the final. */
const FINAL_TOP = 5;
/** Demo serials: SLO-YYYY-9NNNNN; certificate_serial_seq stops at 899999, so a real serial never meets these. */
const DEMO_SERIAL_START = 900_001;
const VIDEO_IDS = ['dQw4w9WgXcQ', 'M7lc1UVf-VE', 'aqz-KE-bpKQ', 'ScMzIvxBSi4', 'jNQXAC9IVRw'];

interface Candidate {
  userId: string;
  name: string;
  category: Category;
  score: number;
  time: number;
}

/**
 * The rounds after Round 1 (core's area; DECISIONS "Demo data" D2), after the demo Round 1 results are published:
 * the promotion from the demo Round 1 by its snapshot, the video round (videos, the two demo judges' scores over the
 * round's criteria, evaluated entries), the promotion into the demo final, and certificates. Rows are written as
 * promotion.service, video.service, jury.service and certificate-issuer write them; nothing touches a real round.
 * Needs the demo rounds, the demo Round 1 exam and an admin (the runs' and assignments' author), else it does nothing.
 */
export const progressDemoGenerator: DemoGenerator = {
  area: 'progress',
  dependsOn: [],
  phase: 'afterResults',
  async load(ctx: DemoContext): Promise<void> {
    const { rounds, adminId } = ctx;
    const examId = ctx.exams.round1;
    if (!rounds || !adminId || !examId) return;
    await ctx.progress('promotion');
    const exam = await ctx.tx.exam.findUniqueOrThrow({
      where: { id: examId },
      select: { resultsGeneration: true, resultsPublishedAt: true },
    });
    if (!exam.resultsPublishedAt || exam.resultsGeneration < 1) return;
    const board = await ctx.tx.leaderboardEntry.findMany({
      where: { examId, generation: exam.resultsGeneration, category: { not: null } },
      select: { userId: true, name: true, category: true, score: true, timeTakenSeconds: true },
    });
    const now = ctx.now.getTime();
    const entries: Prisma.RoundEntryCreateManyInput[] = [];
    const runs: Prisma.PromotionRunCreateManyInput[] = [];
    const judges = ctx.users.jury;
    const assignments: Prisma.JuryAssignmentCreateManyInput[] = [];
    const scores: Prisma.JuryScoreCreateManyInput[] = [];
    const inVideo: string[] = [];
    const inFinal: string[] = [];
    const keys = DEFAULT_VIDEO_CRITERIA.map((c) => c.key);

    for (const category of CATEGORIES) {
      // Round 1 -> video, as promotion.service ranks a quiz round: score DESC, time ASC; everyone ranked <= N goes.
      const field: Candidate[] = board
        .filter((b) => b.category === category)
        .map((b) => ({
          userId: b.userId,
          name: b.name,
          category,
          score: b.score,
          time: b.timeTakenSeconds,
        }))
        .sort((a, b) => b.score - a.score || a.time - b.time);
      if (field.length === 0) continue;
      const topN = Math.max(1, Math.round(field.length * ROUND1_SHARE));
      const promoted = upTo(field, topN, (a, b) => a.score === b.score && a.time === b.time);
      const run1 = randomUUID();
      const run1At = new Date(now - 8 * DAY - DAY / 2);
      runs.push({
        id: run1,
        fromRoundId: rounds.r1,
        toRoundId: rounds.video,
        category,
        topN,
        sourceKind: 'exam',
        sourceExamId: examId,
        sourceGeneration: exam.resultsGeneration,
        promotedCount: promoted.length,
        eliminatedCount: field.length - promoted.length,
        createdById: adminId,
        createdAt: run1At,
      });
      const promotedIds = new Set(promoted.map((p) => p.userId));
      for (const c of field)
        entries.push({
          id: randomUUID(),
          userId: c.userId,
          roundId: rounds.r1,
          status: promotedIds.has(c.userId) ? 'promoted' : 'eliminated',
          createdAt: run1At,
          updatedAt: run1At,
        });

      // The video round: most send a video in the window; both judges score every video of the category.
      for (const j of judges)
        assignments.push({
          id: randomUUID(),
          roundId: rounds.video,
          judgeId: j.id,
          category,
          createdById: adminId,
          createdAt: run1At,
        });
      const evaluated: { entryId: string; userId: string; score: number }[] = [];
      const videoEntryIds = new Map<string, string>();
      for (const p of promoted) {
        const id = randomUUID();
        videoEntryIds.set(p.userId, id);
        inVideo.push(p.userId);
        const sent = ctx.rng.chance(VIDEO_SHARE);
        if (!sent) {
          entries.push({
            id,
            userId: p.userId,
            roundId: rounds.video,
            status: 'pending',
            promotionRunId: run1,
            createdAt: run1At,
            updatedAt: run1At,
          });
          continue;
        }
        const sentAt = new Date(now - 8 * DAY + ctx.rng.int(5 * DAY));
        const totals = judges.map((j) => {
          const skill = 3 + ctx.rng.int(7); // 3..9: the judge's view of this video
          const criteria = Object.fromEntries(
            keys.map((k) => [k, Math.min(10, Math.max(0, skill - 1 + ctx.rng.int(3)))]),
          );
          const sum = Object.values(criteria).reduce((a, b) => a + b, 0);
          const total = Math.round(((sum * 100) / (10 * keys.length)) * 100) / 100;
          scores.push({
            id: randomUUID(),
            entryId: id,
            judgeId: j.id,
            criteria,
            total: new Prisma.Decimal(total),
            createdAt: new Date(now - DAY - ctx.rng.int(DAY / 2)),
          });
          return total;
        });
        const score =
          totals.length > 0
            ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100
            : 0;
        entries.push({
          id,
          userId: p.userId,
          roundId: rounds.video,
          status: totals.length > 0 ? 'evaluated' : 'submitted',
          score: totals.length > 0 ? new Prisma.Decimal(score) : null,
          videoUrl: `https://www.youtube.com/watch?v=${ctx.rng.pick(VIDEO_IDS)}`,
          videoSubmittedAt: sentAt,
          promotionRunId: run1,
          createdAt: run1At,
          updatedAt: sentAt,
        });
        if (totals.length > 0) evaluated.push({ entryId: id, userId: p.userId, score });
      }

      // Video -> final, as promotion.service ranks a video round: score DESC among evaluated entries.
      if (judges.length === 0 || evaluated.length === 0) continue;
      evaluated.sort((a, b) => b.score - a.score);
      const top = Math.min(FINAL_TOP, evaluated.length);
      const toFinal = upTo(evaluated, top, (a, b) => a.score === b.score);
      const finalIds = new Set(toFinal.map((f) => f.userId));
      const run2 = randomUUID();
      const run2At = new Date(now - DAY / 2);
      runs.push({
        id: run2,
        fromRoundId: rounds.video,
        toRoundId: rounds.final,
        category,
        topN: top,
        sourceKind: 'jury',
        promotedCount: toFinal.length,
        eliminatedCount: promoted.length - toFinal.length,
        createdById: adminId,
        createdAt: run2At,
      });
      for (const e of entries)
        if (e.roundId === rounds.video && e.promotionRunId === run1) {
          e.status = finalIds.has(e.userId) ? 'promoted' : 'eliminated';
          e.updatedAt = run2At;
        }
      for (const f of toFinal) {
        inFinal.push(f.userId);
        entries.push({
          id: randomUUID(),
          userId: f.userId,
          roundId: rounds.final,
          status: 'pending',
          promotionRunId: run2,
          createdAt: run2At,
          updatedAt: run2At,
        });
      }
    }
    if (runs.length === 0) return;

    // Runs before the entries that point at them; scores after their entries.
    await ctx.tx.promotionRun.createMany({ data: runs });
    await ctx.tx.roundEntry.createMany({ data: entries });
    await ctx.progress('jury');
    if (assignments.length) await ctx.tx.juryAssignment.createMany({ data: assignments });
    if (scores.length) await ctx.tx.juryScore.createMany({ data: scores });
    await ctx.register(
      'promotion_runs',
      runs.map((r) => r.id as string),
    );
    await ctx.register(
      'round_entries',
      entries.map((e) => e.id as string),
    );
    await ctx.register(
      'jury_assignments',
      assignments.map((a) => a.id as string),
    );
    await ctx.register(
      'jury_scores',
      scores.map((s) => s.id as string),
    );

    await ctx.progress('certificates');
    await certificates(ctx, rounds, board, inVideo, inFinal);
  },
};

/** The first n of a sorted list, plus everyone tied with the n-th (promotion.service: ties at the cut go through). */
function upTo<T>(sorted: readonly T[], n: number, tie: (a: T, b: T) => boolean): T[] {
  if (sorted.length <= n) return [...sorted];
  const last = sorted[n - 1]!;
  let end = n;
  while (end < sorted.length && tie(sorted[end]!, last)) end += 1;
  return sorted.slice(0, end);
}

/**
 * Participation for the Round 1 field, promotion for the video round and the final; no winner, since the final is
 * still ahead (its entries are pending, core's review); the name
 * copied at issue (certificate-issuer). Serials from the demo range, never certificate_serial_seq.
 */
async function certificates(
  ctx: DemoContext,
  rounds: NonNullable<DemoContext['rounds']>,
  board: readonly { userId: string }[],
  inVideo: readonly string[],
  inFinal: readonly string[],
): Promise<void> {
  const users = await ctx.tx.user.findMany({
    where: { demoBatchId: ctx.batchId },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name.slice(0, 200)]));
  const year = new Date(ctx.now.getTime() + 6 * 3_600_000).getUTCFullYear(); // the Asia/Dhaka year
  const issuedAt = new Date(ctx.now.getTime() - 3_600_000);
  let serial = DEMO_SERIAL_START;
  const rows: Prisma.CertificateCreateManyInput[] = [];
  const add = (userId: string, type: 'participation' | 'promotion', roundId: string) =>
    rows.push({
      id: randomUUID(),
      userId,
      type,
      roundId,
      serial: `SLO-${year}-${serial++}`,
      verificationCode: randomBytes(6).toString('hex').toUpperCase(),
      nameOnCertificate: names.get(userId) ?? 'Demo Student',
      issuedAt,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    });
  for (const b of board) add(b.userId, 'participation', rounds.r1);
  for (const u of inVideo) add(u, 'promotion', rounds.video);
  for (const u of inFinal) add(u, 'promotion', rounds.final);
  if (rows.length === 0) return;
  await ctx.tx.certificate.createMany({ data: rows });
  await ctx.register(
    'certificates',
    rows.map((r) => r.id as string),
  );
}
