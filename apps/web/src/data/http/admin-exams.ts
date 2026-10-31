import {
  ATTEMPT_STATUSES,
  CATEGORIES,
  END_REASONS,
  EXAM_EVENT_TYPES,
  EXAM_STATUSES,
  type AdminAttemptDetail,
  type AdminAttemptRow,
  type AdminExamCard,
  type AdminExamView,
  type AdminQuestion,
  type ExamResultsStatus,
  type Paginated,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, getJsonOrNull, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * Admin exam reads (exam session; E1's management API and E3's results API). Admin shapes carry the correct keys,
 * so they are only ever read here, for admin pages; the picks still keep any field the API adds later out.
 */

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);
const isCount = (value: unknown): value is number => Number.isInteger(value);
const isFlag = (value: unknown): value is boolean => typeof value === 'boolean';
const oneOf = (list: readonly string[], value: unknown): boolean =>
  (list as readonly unknown[]).includes(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCard(value: unknown): value is AdminExamCard {
  return (
    isRecord(value) &&
    isText(value.id) &&
    isText(value.title) &&
    (value.category === null || oneOf(CATEGORIES, value.category)) &&
    oneOf(EXAM_STATUSES, value.status) &&
    isCount(value.durationMinutes) &&
    isCount(value.questionsPerAttempt) &&
    isText(value.windowStart) &&
    isText(value.windowEnd) &&
    isCount(value.questionCount) &&
    isFlag(value.locked)
  );
}

function isQuestion(value: unknown): value is AdminQuestion {
  return (
    isRecord(value) &&
    isText(value.id) &&
    isText(value.lineageId) &&
    isCount(value.version) &&
    isCount(value.position) &&
    isText(value.text) &&
    Array.isArray(value.options) &&
    value.options.every((o) => isRecord(o) && isText(o.key) && isText(o.text)) &&
    isText(value.correctKey) &&
    isTextOrNull(value.explanation) &&
    isFlag(value.keepOptionOrder) &&
    isFlag(value.isActive) &&
    isTextOrNull(value.deactivatedAt) &&
    isText(value.createdAt) &&
    isText(value.updatedAt)
  );
}

function isView(value: unknown): value is AdminExamView {
  if (!isCard(value)) return false;
  const v = value as unknown as Record<string, unknown>;
  const round = v.round;
  return (
    isCount(v.graceSeconds) &&
    isTextOrNull(v.resultsPublishedAt) &&
    (round === null || (isRecord(round) && isText(round.id) && isText(round.name))) &&
    isTextOrNull(v.roundId) &&
    isFlag(v.randomDraw) &&
    isCount(v.contentVersion) &&
    isTextOrNull(v.publishedAt) &&
    isText(v.updatedAt) &&
    Array.isArray(v.questions) &&
    v.questions.every(isQuestion)
  );
}

function isResults(value: unknown): value is ExamResultsStatus {
  return (
    isRecord(value) &&
    isText(value.examId) &&
    isFlag(value.windowClosed) &&
    isRecord(value.counts) &&
    ATTEMPT_STATUSES.every((s) => isCount((value.counts as Record<string, unknown>)[s])) &&
    isTextOrNull(value.snapshotAt) &&
    isCount(value.generation) &&
    isTextOrNull(value.publishedAt) &&
    isFlag(value.canBuild) &&
    isFlag(value.canPublish)
  );
}

function isAttempt(value: unknown): value is AdminAttemptRow {
  return (
    isRecord(value) &&
    isText(value.attemptId) &&
    isText(value.userId) &&
    isText(value.name) &&
    isText(value.email) &&
    oneOf(ATTEMPT_STATUSES, value.status) &&
    (value.endReason === null || oneOf(END_REASONS, value.endReason)) &&
    (value.violationCount === null || isCount(value.violationCount)) &&
    isText(value.startedAt) &&
    isText(value.endsAt) &&
    isTextOrNull(value.submittedAt) &&
    (value.timeTakenSeconds === null || isCount(value.timeTakenSeconds)) &&
    (value.score === null || typeof value.score === 'number')
  );
}

function isAttemptDetail(value: unknown): value is AdminAttemptDetail {
  if (!isAttempt(value)) return false;
  const events = (value as unknown as Record<string, unknown>).events;
  return (
    Array.isArray(events) &&
    events.every((e) => isRecord(e) && oneOf(EXAM_EVENT_TYPES, e.type) && isCount(e.at))
  );
}

function isPageOf<T>(row: (item: unknown) => item is T) {
  return (value: unknown): value is Paginated<T> =>
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(row) &&
    isCount(value.page) &&
    isCount(value.pageSize) &&
    isCount(value.total);
}

const pickCard = (e: AdminExamCard): AdminExamCard => ({
  id: e.id,
  title: e.title,
  category: e.category,
  status: e.status,
  durationMinutes: e.durationMinutes,
  questionsPerAttempt: e.questionsPerAttempt,
  windowStart: e.windowStart,
  windowEnd: e.windowEnd,
  questionCount: e.questionCount,
  locked: e.locked,
});

const pickView = (e: AdminExamView): AdminExamView => ({
  ...pickCard(e),
  graceSeconds: e.graceSeconds,
  resultsPublishedAt: e.resultsPublishedAt,
  round: e.round && { id: e.round.id, name: e.round.name },
  roundId: e.roundId,
  randomDraw: e.randomDraw,
  contentVersion: e.contentVersion,
  publishedAt: e.publishedAt,
  updatedAt: e.updatedAt,
  questions: e.questions.map((q) => ({
    id: q.id,
    lineageId: q.lineageId,
    version: q.version,
    position: q.position,
    text: q.text,
    options: q.options.map((o) => ({ key: o.key, text: o.text })),
    correctKey: q.correctKey,
    explanation: q.explanation,
    keepOptionOrder: q.keepOptionOrder,
    isActive: q.isActive,
    deactivatedAt: q.deactivatedAt,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  })),
});

const pickResults = (r: ExamResultsStatus): ExamResultsStatus => ({
  examId: r.examId,
  windowClosed: r.windowClosed,
  counts: {
    in_progress: r.counts.in_progress,
    submitted: r.counts.submitted,
    expired: r.counts.expired,
    scored: r.counts.scored,
  },
  snapshotAt: r.snapshotAt,
  generation: r.generation,
  publishedAt: r.publishedAt,
  canBuild: r.canBuild,
  canPublish: r.canPublish,
});

const pickAttempt = (a: AdminAttemptRow): AdminAttemptRow => ({
  attemptId: a.attemptId,
  userId: a.userId,
  name: a.name,
  email: a.email,
  status: a.status,
  endReason: a.endReason,
  violationCount: a.violationCount,
  startedAt: a.startedAt,
  endsAt: a.endsAt,
  submittedAt: a.submittedAt,
  timeTakenSeconds: a.timeTakenSeconds,
  score: a.score,
});

const examPath = (id: string) => `/admin/exams/${encodeURIComponent(id)}`;

export function adminExams(
  get: ApiGet,
): Pick<
  DataSource['admin'],
  'listExams' | 'getExam' | 'getExamResults' | 'listAttempts' | 'getAttempt'
> {
  return {
    /** GET /admin/exams (E1). */
    async listExams(query) {
      const path = withQuery('/admin/exams', {
        page: query.page,
        pageSize: query.pageSize,
        q: query.q,
        status: query.status,
      });
      const list = await getJson(get, path, isPageOf(isCard));
      return { ...pageOf(list), items: list.items.map(pickCard) };
    },

    /** GET /admin/exams/:id (E1): null for an unknown or malformed id (no request for the latter). */
    async getExam(id) {
      if (!UUID.test(id)) return null;
      const exam = await getJsonOrNull(get, examPath(id), isView);
      return exam && pickView(exam);
    },

    /** GET /admin/exams/:id/results (E3). */
    async getExamResults(id) {
      if (!UUID.test(id)) return null;
      const results = await getJsonOrNull(get, `${examPath(id)}/results`, isResults);
      return results && pickResults(results);
    },

    /** GET /admin/exams/:id/attempts (E3; owner Q4). */
    async listAttempts(examId, query) {
      if (!UUID.test(examId))
        return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
      const path = withQuery(`${examPath(examId)}/attempts`, {
        page: query.page,
        pageSize: query.pageSize,
        q: query.q,
        status: query.status,
        endReason: query.endReason,
        minViolations: query.minViolations,
      });
      const list = await getJson(get, path, isPageOf(isAttempt));
      return { ...pageOf(list), items: list.items.map(pickAttempt) };
    },

    /** GET /admin/exams/:id/attempts/:attemptId (E3): the attempt with its events. */
    async getAttempt(examId, attemptId) {
      if (!UUID.test(examId) || !UUID.test(attemptId)) return null;
      const attempt = await getJsonOrNull(
        get,
        `${examPath(examId)}/attempts/${encodeURIComponent(attemptId)}`,
        isAttemptDetail,
      );
      return (
        attempt && {
          ...pickAttempt(attempt),
          events: attempt.events.map((e) => ({ type: e.type, at: e.at })),
        }
      );
    },
  };
}

const pageOf = <T>(list: Paginated<T>) => ({
  page: list.page,
  pageSize: list.pageSize,
  total: list.total,
});
