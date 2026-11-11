import type { PrismaClient } from '@prisma/client';
import type { StudentNextExam } from '@sirat/shared';

/**
 * The student's next olympiad exam, for the admit card (core; the lead's 10 Nov queue): the published exam of a round
 * whose window has not ended yet, nearest first, among the exams the student may take. The visibility rules are those
 * of visibleTo (student-access.ts): the student's category or everyone, and demo data never mixes with real data. A
 * practice exam (no round) never counts: the demo practice exam stays open for a month. Null when there is none (the
 * card then says "to be announced") or the account is unknown or blocked. A plain function of a Prisma client, so the
 * API and the worker's PDF renderer call it alike. Nothing about attempts or scores.
 */
export async function nextExamFor(
  prisma: Pick<PrismaClient, 'user' | 'exam'>,
  userId: string,
  now: Date = new Date(),
): Promise<StudentNextExam | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { category: true, demoBatchId: true, isBlocked: true },
  });
  if (!user || user.isBlocked) return null;
  const exam = await prisma.exam.findFirst({
    where: {
      status: 'published',
      roundId: { not: null },
      windowEnd: { gt: now },
      demoBatchId: user.demoBatchId === null ? null : { not: null },
      OR: user.category ? [{ category: null }, { category: user.category }] : [{ category: null }],
    },
    orderBy: [{ windowStart: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      windowStart: true,
      windowEnd: true,
      durationMinutes: true,
      round: { select: { name: true } },
    },
  });
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
