import {
  ATTEMPT_PHASES,
  CATEGORIES,
  END_REASONS,
  STUDENT_EXAM_STATES,
  type StudentExamCard,
  type StudentExamDetail,
  type StudentExamListItem,
  type SubmissionReceipt,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, getJsonOrNull, isRecord, type ApiGet } from './request.ts';

/*
 * Exam reads (owned by the exam session after the skeleton; docs/plans/EXAM-PLAN.md). The example area of the
 * HTTP source: one endpoint, a shape check, and an explicit pick so a field the API adds later never reaches a
 * page by accident.
 */

const isText = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number => Number.isInteger(value);
const oneOf = (list: readonly string[], value: unknown): boolean =>
  (list as readonly unknown[]).includes(value);
/** The API's ids; anything else is not found here (the API would answer 400). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isExamCard(value: unknown): value is StudentExamCard {
  return (
    isRecord(value) &&
    isText(value.id) &&
    isText(value.title) &&
    (value.category === null || (CATEGORIES as readonly unknown[]).includes(value.category)) &&
    isCount(value.durationMinutes) &&
    isCount(value.questionsPerAttempt) &&
    isText(value.windowStart) &&
    isText(value.windowEnd) &&
    (STUDENT_EXAM_STATES as readonly unknown[]).includes(value.state)
  );
}

const isExamListItem = (value: unknown): value is StudentExamListItem =>
  isExamCard(value) &&
  typeof (value as { resultsPublished?: unknown }).resultsPublished === 'boolean';

const isExamList = (value: unknown): value is StudentExamListItem[] =>
  Array.isArray(value) && value.every(isExamListItem);

const pickExamCard = (exam: StudentExamCard): StudentExamCard => ({
  id: exam.id,
  title: exam.title,
  category: exam.category,
  durationMinutes: exam.durationMinutes,
  questionsPerAttempt: exam.questionsPerAttempt,
  windowStart: exam.windowStart,
  windowEnd: exam.windowEnd,
  state: exam.state,
});

function isReceipt(value: unknown): value is SubmissionReceipt {
  return (
    isRecord(value) &&
    isText(value.receiptId) &&
    isText(value.submittedAt) &&
    oneOf(END_REASONS, value.endReason)
  );
}

function isExamDetail(value: unknown): value is StudentExamDetail {
  if (!isExamCard(value)) return false;
  const v = value as unknown as Record<string, unknown>;
  const attempt = v.attempt;
  return (
    typeof v.resultsPublished === 'boolean' &&
    isCount(v.graceSeconds) &&
    isCount(v.violationWarnings) &&
    isText(v.serverNow) &&
    (attempt === null ||
      (isRecord(attempt) &&
        isText(attempt.attemptId) &&
        oneOf(ATTEMPT_PHASES, attempt.phase) &&
        isText(attempt.endsAt) &&
        (attempt.receipt === null || isReceipt(attempt.receipt))))
  );
}

/** The waiting room: never questions, never a score (the API sends neither; the pick keeps it so). */
const pickExamDetail = (exam: StudentExamDetail): StudentExamDetail => ({
  ...pickExamCard(exam),
  resultsPublished: exam.resultsPublished,
  graceSeconds: exam.graceSeconds,
  violationWarnings: exam.violationWarnings,
  serverNow: exam.serverNow,
  attempt: exam.attempt && {
    attemptId: exam.attempt.attemptId,
    phase: exam.attempt.phase,
    endsAt: exam.attempt.endsAt,
    receipt: exam.attempt.receipt && {
      receiptId: exam.attempt.receipt.receiptId,
      submittedAt: exam.attempt.receipt.submittedAt,
      endReason: exam.attempt.receipt.endReason,
    },
  },
});

export function studentExams(get: ApiGet): Pick<DataSource['student'], 'listExams' | 'getExam'> {
  return {
    /** GET /exams: the student's exams, state from the server clock (E2). */
    async listExams() {
      return (await getJson(get, '/exams', isExamList)).map((exam) => ({
        ...pickExamCard(exam),
        resultsPublished: exam.resultsPublished,
      }));
    },

    /** GET /exams/:id: the waiting room; null (not found) for an unknown, hidden or malformed id (E2). */
    async getExam(id) {
      if (!UUID.test(id)) return null;
      const exam = await getJsonOrNull(get, `/exams/${encodeURIComponent(id)}`, isExamDetail);
      return exam && pickExamDetail(exam);
    },
  };
}
