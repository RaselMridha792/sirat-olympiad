import type { AttemptPhase, StudentExamState } from '@sirat/shared';

/*
 * Time rules (EXAM-PLAN 3.1, 3.8, 3.11). The server clock decides; these helpers only compare instants it gives them.
 */

export interface AttemptTimes {
  status: 'in_progress' | 'submitted' | 'expired' | 'scored';
  endsAt: Date;
}

/** Accepted up to and including ends_at + grace; one millisecond later is too late. */
export const withinGrace = (endsAt: Date, graceSeconds: number, now: Date): boolean =>
  now.getTime() <= endsAt.getTime() + graceSeconds * 1000;

export const remainingSeconds = (endsAt: Date, now: Date): number =>
  Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 1000));

/** Server time the student spent: from the start to the submit, never past ends_at (the grace adds no time). */
export const timeTakenSeconds = (startedAt: Date, endsAt: Date, submittedAt: Date): number =>
  Math.max(
    0,
    Math.floor((Math.min(submittedAt.getTime(), endsAt.getTime()) - startedAt.getTime()) / 1000),
  );

export function attemptPhase(attempt: AttemptTimes, graceSeconds: number, now: Date): AttemptPhase {
  if (attempt.status !== 'in_progress') return 'submitted';
  return withinGrace(attempt.endsAt, graceSeconds, now) ? 'in_progress' : 'time_over';
}

/** The card state on GET /exams (EXAM-PLAN 3.11). */
export function studentExamState(
  exam: { windowStart: Date; windowEnd: Date; graceSeconds: number },
  attempt: AttemptTimes | null,
  now: Date,
): StudentExamState {
  if (attempt)
    return attemptPhase(attempt, exam.graceSeconds, now) === 'in_progress'
      ? 'in_progress'
      : 'submitted';
  if (now.getTime() < exam.windowStart.getTime()) return 'upcoming';
  if (now.getTime() < exam.windowEnd.getTime()) return 'open';
  return 'closed';
}
