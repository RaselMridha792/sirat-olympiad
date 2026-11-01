import type { AdminQuestionInput, ExamAdminRefusal, QuestionOption } from '@sirat/shared';

/*
 * The exam admin rules as pure functions (docs/plans/EXAM-PLAN.md 4.1, 4.2), so they are unit-tested without a
 * database. The database triggers and CHECKs enforce the same lock independently.
 */

const MINUTE_MS = 60_000;

/** Problems with a question's options and correct key (the DTO already checked sizes and formats). */
export function questionProblems(
  input: Pick<AdminQuestionInput, 'options' | 'correctKey'>,
): ExamAdminRefusal[] {
  const keys = input.options.map((o) => o.key);
  const problems: ExamAdminRefusal[] = [];
  if (new Set(keys).size !== keys.length) problems.push('duplicate_option_key');
  if (!keys.includes(input.correctKey)) problems.push('correct_key_missing');
  return problems;
}

export interface WindowInput {
  windowStart: Date;
  windowEnd: Date;
  durationMinutes: number;
}

/** The window must hold at least one whole exam (05-DATABASE keeps only `window_end > window_start` as a CHECK). */
export function windowProblems(w: WindowInput): ExamAdminRefusal[] {
  return w.windowEnd.getTime() - w.windowStart.getTime() < w.durationMinutes * MINUTE_MS
    ? ['window_too_short']
    : [];
}

export interface PublishInput extends WindowInput {
  questionsPerAttempt: number;
  randomDraw: boolean;
  /** Active questions only. */
  questions: Array<{ text: string; options: unknown; correctKey: string }>;
}

/**
 * Normalised for the duplicate check: case, surrounding and repeated spaces do not make a question different. The
 * CSV import (question-import.ts) uses the same rule.
 */
export const normaliseText = (s: string): string =>
  s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Why a draft cannot be published now; empty when it can (EXAM-PLAN 4.2, owner Q2). */
export function publishProblems(exam: PublishInput, now: Date): ExamAdminRefusal[] {
  const problems: ExamAdminRefusal[] = [];
  const count = exam.questions.length;
  const poolOk = exam.randomDraw
    ? count >= exam.questionsPerAttempt
    : count === exam.questionsPerAttempt;
  if (!poolOk) problems.push('question_count');
  problems.push(...windowProblems(exam));
  if (exam.windowEnd.getTime() <= now.getTime()) problems.push('window_over');
  const texts = exam.questions.map((q) => normaliseText(q.text));
  if (new Set(texts).size !== texts.length) problems.push('duplicate_question_text');
  for (const q of exam.questions) {
    const options = Array.isArray(q.options) ? (q.options as QuestionOption[]) : [];
    for (const p of questionProblems({ options, correctKey: q.correctKey }))
      if (!problems.includes(p)) problems.push(p);
  }
  return problems;
}

/** Unpublishing is safe only well before the window opens (no attempt can exist yet; EXAM-PLAN D9). */
export function unpublishProblems(
  exam: { windowStart: Date },
  attemptCount: number,
  now: Date,
  minutesBeforeStart: number,
): ExamAdminRefusal[] {
  const problems: ExamAdminRefusal[] = [];
  if (now.getTime() >= exam.windowStart.getTime() - minutesBeforeStart * MINUTE_MS)
    problems.push('window_started');
  if (attemptCount > 0) problems.push('has_attempts');
  return problems;
}

/** A published exam's window may only grow, and only while it is still open (EXAM-PLAN 4.1, D13). */
export function canExtendWindow(current: Date, next: Date, now: Date): boolean {
  return next.getTime() > current.getTime() && current.getTime() > now.getTime();
}
