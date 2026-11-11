import type { PrismaClient } from '@prisma/client';
import type { StudentNextExam } from '@sirat/shared';
import { gatedRounds } from './exam-cache';
import { roundOpenTo } from './student-access';

/** Enough candidates to get past round-gated exams the student may not take. */
const CANDIDATES = 25;

/**
 * The student's next olympiad exam, for the admit card (core; the lead's 10 Nov queue): the published exam of a round
 * whose window has not ended yet, nearest first, among the exams the student may take. The visibility rules are those
 * of visibleTo (student-access.ts): the student's category or everyone, demo data never mixes with real data, and the
 * round rule (an exam in a round after its side's first round only for students with a non-eliminated entry there). A
 * practice exam (no round) never counts: the demo practice exam stays open for a month. Null when there is none (the
 * card then says "to be announced") or the account is unknown or blocked. A plain function of a Prisma client, so the
 * API and the worker's PDF renderer call it alike. Nothing about attempts or scores.
 */
export async function nextExamFor(
  prisma: Pick<PrismaClient, 'user' | 'exam' | 'roundEntry' | '$queryRaw'>,
  userId: string,
  now: Date = new Date(),
): Promise<StudentNextExam | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { category: true, demoBatchId: true, isBlocked: true },
  });
  if (!user || user.isBlocked) return null;
  const candidates = await prisma.exam.findMany({
    where: {
      status: 'published',
      roundId: { not: null },
      windowEnd: { gt: now },
      demoBatchId: user.demoBatchId === null ? null : { not: null },
      OR: user.category ? [{ category: null }, { category: user.category }] : [{ category: null }],
    },
    orderBy: [{ windowStart: 'asc' }, { id: 'asc' }],
    take: CANDIDATES,
    select: {
      id: true,
      roundId: true,
      title: true,
      windowStart: true,
      windowEnd: true,
      durationMinutes: true,
      round: { select: { name: true } },
    },
  });
  // The round rule, with visibleTo's own predicate (roundOpenTo): entries are read only if a candidate is gated.
  const gated = await gatedRounds(
    prisma,
    candidates.map((c) => c.roundId),
  );
  const entryRoundIds = candidates.some((c) => c.roundId !== null && gated.has(c.roundId))
    ? new Set(
        (
          await prisma.roundEntry.findMany({
            where: { userId, status: { not: 'eliminated' } },
            select: { roundId: true },
          })
        ).map((r) => r.roundId),
      )
    : undefined;
  const exam = candidates.find((c) =>
    roundOpenTo(
      { roundId: c.roundId, roundGated: c.roundId !== null && gated.has(c.roundId) },
      { entryRoundIds },
    ),
  );
  if (!exam) return null;
  return {
    examId: exam.id,
    title: exam.title,
    windowStart: exam.windowStart.toISOString(),
    windowEnd: exam.windowEnd.toISOString(),
    durationMinutes: exam.durationMinutes,
    roundName: exam.round?.name ?? null,
  };
}
