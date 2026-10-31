import {
  CATEGORIES,
  ENTRY_STATUSES,
  type AdminExamLeaderboard,
  type AdminLeaderboardRow,
  type ExamLeaderboard,
  type ExamLeaderboardExam,
  type LeaderboardQuery,
  type LeaderboardRow,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * Leaderboard reads (exam session; E3's per-exam snapshot, owner Q5). Students get rank, name and institution only;
 * the explicit picks keep it so even if the API ever sent more. Admins also get email, category, score and time.
 */

const isText = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number => Number.isInteger(value);
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);
const oneOf = (list: readonly string[], value: unknown): boolean =>
  (list as readonly unknown[]).includes(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isExamInfo(value: unknown): value is ExamLeaderboardExam {
  return (
    isRecord(value) &&
    isText(value.id) &&
    isText(value.title) &&
    (value.category === null || oneOf(CATEGORIES, value.category))
  );
}

function isRow(value: unknown): value is LeaderboardRow {
  return (
    isRecord(value) &&
    isCount(value.rank) &&
    isText(value.name) &&
    isTextOrNull(value.institution) &&
    (value.entryStatus === null || oneOf(ENTRY_STATUSES, value.entryStatus))
  );
}

function isAdminRow(value: unknown): value is AdminLeaderboardRow {
  if (!isRow(value)) return false;
  const v = value as unknown as Record<string, unknown>;
  return (
    isText(v.userId) &&
    isText(v.email) &&
    (v.category === null || oneOf(CATEGORIES, v.category)) &&
    (v.score === null || typeof v.score === 'number') &&
    (v.timeTakenSeconds === null || isCount(v.timeTakenSeconds))
  );
}

function isPage(value: unknown, row: (item: unknown) => boolean): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(row) &&
    isCount(value.page) &&
    isCount(value.pageSize) &&
    isCount(value.total)
  );
}

function isBoard(value: unknown): value is ExamLeaderboard {
  return (
    isPage(value, isRow) &&
    isRecord(value) &&
    (value.exam === null || isExamInfo(value.exam)) &&
    oneOf(['unpublished', 'published'], value.status) &&
    isTextOrNull(value.snapshotAt)
  );
}

function isAdminBoard(value: unknown): value is AdminExamLeaderboard {
  return (
    isPage(value, isAdminRow) &&
    isRecord(value) &&
    (value.exam === null || isExamInfo(value.exam)) &&
    typeof value.isPublic === 'boolean' &&
    isTextOrNull(value.snapshotAt) &&
    isCount(value.generation)
  );
}

const pickExam = (exam: ExamLeaderboardExam | null): ExamLeaderboardExam | null =>
  exam && { id: exam.id, title: exam.title, category: exam.category };

const pickRow = (row: LeaderboardRow): LeaderboardRow => ({
  rank: row.rank,
  name: row.name,
  institution: row.institution,
  entryStatus: row.entryStatus,
});

const pickAdminRow = (row: AdminLeaderboardRow): AdminLeaderboardRow => ({
  ...pickRow(row),
  userId: row.userId,
  email: row.email,
  category: row.category,
  score: row.score,
  timeTakenSeconds: row.timeTakenSeconds,
});

/** The query string; an exam id the API would refuse (not a UUID) falls back to the latest exam with results. */
const path = (base: string, query: LeaderboardQuery) =>
  withQuery(base, {
    exam: query.exam && UUID.test(query.exam) ? query.exam : undefined,
    page: query.page,
    pageSize: query.pageSize,
    q: query.q,
  });

export function leaderboard(get: ApiGet): DataSource['leaderboard'] {
  return {
    /** GET /leaderboard: empty and `unpublished` until an admin publishes the exam's results (E3). */
    async get(query) {
      const board = await getJson(get, path('/leaderboard', query), isBoard);
      return {
        items: board.items.map(pickRow),
        page: board.page,
        pageSize: board.pageSize,
        total: board.total,
        exam: pickExam(board.exam),
        status: board.status,
        snapshotAt: board.snapshotAt,
      };
    },
  };
}

export function adminLeaderboard(get: ApiGet): Pick<DataSource['admin'], 'getLeaderboard'> {
  return {
    /** GET /admin/leaderboard: the snapshot also before it is public (admin and manager). */
    async getLeaderboard(query) {
      const board = await getJson(get, path('/admin/leaderboard', query), isAdminBoard);
      return {
        items: board.items.map(pickAdminRow),
        page: board.page,
        pageSize: board.pageSize,
        total: board.total,
        exam: pickExam(board.exam),
        isPublic: board.isPublic,
        snapshotAt: board.snapshotAt,
        generation: board.generation,
      };
    },
  };
}
