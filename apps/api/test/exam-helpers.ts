import { randomUUID } from 'node:crypto';
import type { EndReason, Prisma, PrismaClient } from '@prisma/client';
import { examData } from './helpers';

/** Four options; the correct key used by questionData() is B. */
export const OPTIONS = [
  { key: 'A', text: 'Alpha' },
  { key: 'B', text: 'Beta' },
  { key: 'C', text: 'Gamma' },
  { key: 'D', text: 'Delta' },
];

const HOUR_MS = 60 * 60 * 1000;

/** A published exam whose window is open now (attempts can only be created for a published exam: attempts_guard). */
export function makePublishedExam(
  prisma: PrismaClient,
  data: Partial<Prisma.ExamUncheckedCreateInput> = {},
) {
  const now = Date.now();
  return prisma.exam.create({
    data: examData({
      windowStart: new Date(now - HOUR_MS),
      windowEnd: new Date(now + 24 * HOUR_MS),
      status: 'published',
      publishedAt: new Date(now - 2 * HOUR_MS),
      ...data,
    }),
  });
}

export function questionData(
  examId: string,
  data: Partial<Prisma.QuestionUncheckedCreateInput> = {},
): Prisma.QuestionUncheckedCreateInput {
  const lineageId = randomUUID();
  return {
    examId,
    lineageId,
    text: `Question ${lineageId.slice(0, 8)}`,
    options: OPTIONS,
    correctKey: 'B',
    position: 1,
    ...data,
  };
}

export function makeAttempt(
  prisma: PrismaClient,
  userId: string,
  examId: string,
  data: Partial<Prisma.AttemptUncheckedCreateInput> = {},
) {
  const startedAt = new Date();
  return prisma.attempt.create({
    data: {
      userId,
      examId,
      startedAt,
      endsAt: new Date(startedAt.getTime() + 30 * 60 * 1000),
      layout: { v: 1, q: [], o: [] },
      questionCount: 1,
      contentVersion: 1,
      ...data,
    },
  });
}

export function submissionData(
  attemptId: string,
  data: Partial<Prisma.SubmissionUncheckedCreateInput> = {},
): Prisma.SubmissionUncheckedCreateInput {
  return {
    attemptId,
    requestId: randomUUID(),
    answers: { v: 1, a: [1] },
    endReason: 'submitted' satisfies EndReason,
    violationCount: 0,
    ...data,
  };
}
