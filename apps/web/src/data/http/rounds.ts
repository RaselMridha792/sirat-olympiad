import {
  CATEGORIES,
  ENTRY_STATUSES,
  ROUND_TYPES,
  type AdminRound,
  type MyRound,
  type RoundCriterion,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, getJsonOrNull, isRecord, type ApiGet } from './request.ts';

/*
 * Rounds (core C6a; 06-API "Rounds"). Reads only: creating, editing and promoting are browser writes through
 * lib/api.ts. Every field is checked and picked by name.
 */

const text = (v: unknown): v is string => typeof v === 'string';
const textOrNull = (v: unknown) => v === null || typeof v === 'string';
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const oneOf = (list: readonly string[]) => (v: unknown) =>
  typeof v === 'string' && list.includes(v);
const isRoundType = oneOf(ROUND_TYPES);
const isEntryStatus = oneOf(ENTRY_STATUSES);
const isCategory = oneOf(CATEGORIES);

const isCriterion = (v: unknown): v is RoundCriterion =>
  isRecord(v) && text(v.key) && text(v.en) && text(v.bn);

const isRoundBase = (v: unknown) =>
  isRecord(v) &&
  text(v.id) &&
  text(v.name) &&
  count(v.sortOrder) &&
  isRoundType(v.type) &&
  textOrNull(v.opensAt) &&
  textOrNull(v.closesAt);

const isMyRound = (v: unknown): v is MyRound =>
  isRecord(v) &&
  isRoundBase(v.round) &&
  (v.entryStatus === null || isEntryStatus(v.entryStatus)) &&
  textOrNull(v.videoUrl) &&
  textOrNull(v.videoSubmittedAt);

const isAdminRound = (v: unknown): v is AdminRound =>
  isRoundBase(v) &&
  isRecord(v) &&
  (v.criteria === null || (Array.isArray(v.criteria) && v.criteria.every(isCriterion))) &&
  typeof v.scored === 'boolean' &&
  isRecord(v.entries) &&
  ENTRY_STATUSES.every((s) => count((v.entries as Record<string, unknown>)[s])) &&
  Array.isArray(v.promotions) &&
  v.promotions.every(
    (p) =>
      isRecord(p) &&
      text(p.id) &&
      isCategory(p.category) &&
      text(p.toRoundId) &&
      count(p.topN) &&
      count(p.promoted) &&
      count(p.eliminated) &&
      text(p.createdAt),
  ) &&
  typeof v.demo === 'boolean' &&
  text(v.createdAt) &&
  text(v.updatedAt);

const isRoundList = (v: unknown): v is { items: AdminRound[] } =>
  isRecord(v) && Array.isArray(v.items) && v.items.every(isAdminRound);

const pickBase = (r: MyRound['round']): MyRound['round'] => ({
  id: r.id,
  name: r.name,
  type: r.type,
  sortOrder: r.sortOrder,
  opensAt: r.opensAt,
  closesAt: r.closesAt,
});

export function pickMyRound(r: MyRound): MyRound {
  return {
    round: pickBase(r.round),
    entryStatus: r.entryStatus,
    videoUrl: r.videoUrl,
    videoSubmittedAt: r.videoSubmittedAt,
  };
}

function pickRound(r: AdminRound): AdminRound {
  return {
    ...pickBase(r),
    criteria: r.criteria && r.criteria.map((c) => ({ key: c.key, en: c.en, bn: c.bn })),
    scored: r.scored,
    entries: Object.fromEntries(
      ENTRY_STATUSES.map((s) => [s, r.entries[s]]),
    ) as AdminRound['entries'],
    promotions: r.promotions.map((p) => ({
      id: p.id,
      category: p.category,
      toRoundId: p.toRoundId,
      topN: p.topN,
      promoted: p.promoted,
      eliminated: p.eliminated,
      createdAt: p.createdAt,
    })),
    demo: r.demo,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function studentRound(get: ApiGet): Pick<DataSource['student'], 'getMyRound'> {
  return {
    /** GET /rounds/me: the student's current round and own entry (null when there is no round at all). */
    async getMyRound() {
      const round = await getJsonOrNull(get, '/rounds/me', isMyRound);
      return round && pickMyRound(round);
    },
  };
}

export function adminRounds(get: ApiGet): Pick<DataSource['admin'], 'listRounds'> {
  return {
    /** GET /admin/rounds: every round in order (at most 10), with entries by status and the promotions (admin). */
    async listRounds() {
      const list = await getJson(get, '/admin/rounds', isRoundList);
      return list.items.map(pickRound);
    },
  };
}
