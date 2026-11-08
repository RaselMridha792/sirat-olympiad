import {
  CATEGORIES,
  type AdminRoundJury,
  type JuryEntryRow,
  type JuryRound,
  type Paginated,
  type RoundCriterion,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, getJsonOrNull, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * The video round's jury (core C6b; 06-API "Rounds"). Reads only: assigning, removing and scoring are browser
 * writes through lib/api.ts. Every field is checked and picked by name; the judge's rows carry no student name.
 */

const text = (v: unknown): v is string => typeof v === 'string';
const textOrNull = (v: unknown) => v === null || typeof v === 'string';
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const isCategory = (v: unknown) =>
  typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
const isPerson = (v: unknown) => isRecord(v) && text(v.userId) && text(v.name) && text(v.email);
const isCriterion = (v: unknown): v is RoundCriterion =>
  isRecord(v) && text(v.key) && text(v.en) && text(v.bn);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRoundJury = (v: unknown): v is AdminRoundJury =>
  isRecord(v) &&
  isRecord(v.round) &&
  text(v.round.id) &&
  text(v.round.name) &&
  Array.isArray(v.assignments) &&
  v.assignments.every(
    (a) =>
      isRecord(a) && text(a.id) && isPerson(a.judge) && isCategory(a.category) && text(a.createdAt),
  ) &&
  Array.isArray(v.candidates) &&
  v.candidates.every(isPerson);

const isJuryRound = (v: unknown): v is JuryRound =>
  isRecord(v) &&
  text(v.id) &&
  text(v.name) &&
  textOrNull(v.closesAt) &&
  typeof v.scoringOpen === 'boolean' &&
  Array.isArray(v.criteria) &&
  v.criteria.every(isCriterion) &&
  Array.isArray(v.categories) &&
  v.categories.every(isCategory) &&
  count(v.pending) &&
  count(v.evaluated);

const isScores = (v: unknown): v is Record<string, number> =>
  isRecord(v) && Object.values(v).every((n) => Number.isInteger(n));

const isEntry = (v: unknown): v is JuryEntryRow =>
  isRecord(v) &&
  text(v.entryId) &&
  text(v.code) &&
  isCategory(v.category) &&
  text(v.videoUrl) &&
  text(v.videoSubmittedAt) &&
  (v.myScore === null ||
    (isRecord(v.myScore) &&
      isScores(v.myScore.criteria) &&
      typeof v.myScore.total === 'number' &&
      textOrNull(v.myScore.comment) &&
      text(v.myScore.scoredAt)));

const isEntryPage = (v: unknown): v is Paginated<JuryEntryRow> =>
  isRecord(v) &&
  Array.isArray(v.items) &&
  v.items.every(isEntry) &&
  count(v.page) &&
  count(v.pageSize) &&
  count(v.total);

const person = (p: { userId: string; name: string; email: string }) => ({
  userId: p.userId,
  name: p.name,
  email: p.email,
});

export function adminJury(
  get: ApiGet,
): Pick<DataSource['admin'], 'getRoundJury' | 'listJuryRounds' | 'listJuryEntries'> {
  return {
    /** GET /admin/rounds/:id/jury (admin): the judges and the jury accounts that can be added. */
    async getRoundJury(id) {
      if (!UUID.test(id)) return null;
      const jury = await getJsonOrNull(get, `/admin/rounds/${id}/jury`, isRoundJury);
      return (
        jury && {
          round: { id: jury.round.id, name: jury.round.name },
          assignments: jury.assignments.map((a) => ({
            id: a.id,
            judge: person(a.judge),
            category: a.category,
            createdAt: a.createdAt,
          })),
          candidates: jury.candidates.map(person),
        }
      );
    },
    /** GET /jury/rounds (jury): the video rounds this judge scores in. */
    async listJuryRounds() {
      const rounds = await getJson(
        get,
        '/jury/rounds',
        (v): v is JuryRound[] => Array.isArray(v) && v.every(isJuryRound),
      );
      return rounds.map((r) => ({
        id: r.id,
        name: r.name,
        closesAt: r.closesAt,
        scoringOpen: r.scoringOpen,
        criteria: r.criteria.map((c) => ({ key: c.key, en: c.en, bn: c.bn })),
        categories: [...r.categories],
        pending: r.pending,
        evaluated: r.evaluated,
      }));
    },
    /** GET /jury/entries?round=&status=&page=&pageSize= (jury): blind rows, the judge's own latest score. */
    async listJuryEntries(query) {
      const page = await getJson(
        get,
        withQuery('/jury/entries', {
          round: query.round,
          status: query.status,
          page: query.page,
          pageSize: query.pageSize,
        }),
        isEntryPage,
      );
      return {
        items: page.items.map((e) => ({
          entryId: e.entryId,
          code: e.code,
          category: e.category,
          videoUrl: e.videoUrl,
          videoSubmittedAt: e.videoSubmittedAt,
          myScore: e.myScore && {
            criteria: { ...e.myScore.criteria },
            total: e.myScore.total,
            comment: e.myScore.comment,
            scoredAt: e.myScore.scoredAt,
          },
        })),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    },
  };
}
