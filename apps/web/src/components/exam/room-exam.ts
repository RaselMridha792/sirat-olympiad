import type { AttemptPhase, StudentExamDetail, SubmissionReceipt } from '@sirat/shared';

/**
 * What the exam room (a client component) gets from the waiting-room detail. Everything handed to a client component
 * is serialized into the page, so the page passes these fields by name and nothing else (the `?mock=leak` page check
 * found the whole object there).
 */
export type RoomExam = Pick<
  StudentExamDetail,
  | 'id'
  | 'state'
  | 'windowStart'
  | 'serverNow'
  | 'durationMinutes'
  | 'questionsPerAttempt'
  | 'violationWarnings'
  | 'resultsPublished'
> & {
  attempt: { phase: AttemptPhase; receipt: SubmissionReceipt | null } | null;
};

export function toRoomExam(exam: StudentExamDetail): RoomExam {
  const receipt = exam.attempt?.receipt ?? null;
  return {
    id: exam.id,
    state: exam.state,
    windowStart: exam.windowStart,
    serverNow: exam.serverNow,
    durationMinutes: exam.durationMinutes,
    questionsPerAttempt: exam.questionsPerAttempt,
    violationWarnings: exam.violationWarnings,
    resultsPublished: exam.resultsPublished,
    attempt: exam.attempt && {
      phase: exam.attempt.phase,
      receipt: receipt && {
        receiptId: receipt.receiptId,
        submittedAt: receipt.submittedAt,
        endReason: receipt.endReason,
      },
    },
  };
}
