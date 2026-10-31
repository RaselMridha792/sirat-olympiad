import { CATEGORIES, STUDENT_EXAM_STATES, type StudentExamCard } from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, isRecord, type ApiGet } from './request.ts';

/*
 * Exam reads (owned by the exam session after the skeleton; docs/plans/EXAM-PLAN.md). The example area of the
 * HTTP source: one endpoint, a shape check, and an explicit pick so a field the API adds later never reaches a
 * page by accident.
 */

const isText = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number => Number.isInteger(value);

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

const isExamCardList = (value: unknown): value is StudentExamCard[] =>
  Array.isArray(value) && value.every(isExamCard);

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

export function studentExams(get: ApiGet): Pick<DataSource['student'], 'listExams'> {
  return {
    /** GET /exams: the student's exams, state from the server clock (E2). */
    async listExams() {
      return (await getJson(get, '/exams', isExamCardList)).map(pickExamCard);
    },
  };
}
