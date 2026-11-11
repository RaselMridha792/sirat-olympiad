import type {
  AdminAmbassadorRow,
  AmbassadorLeaderboard,
  AmbassadorLeaderboardRow,
  AmbassadorOverview,
  AmbassadorPointsConfig,
  Paginated,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { DataRequestError, getJson, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * Ambassadors (core C5a; 06-API "Ambassadors"). Reads only: approving and revoking are admin writes from the browser
 * through lib/api.ts. Every shape is checked and picked field by field, so no other field of a referred student (or
 * anything the API adds later) reaches a page.
 */

const text = (v: unknown): v is string => typeof v === 'string';
const textOrNull = (v: unknown) => v === null || typeof v === 'string';
const count = (v: unknown) => Number.isInteger(v);
const isRank = (v: unknown) =>
  v === null || (isRecord(v) && text(v.name) && Number.isInteger(v.minPoints));

function isOverview(v: unknown): v is AmbassadorOverview {
  return (
    isRecord(v) &&
    textOrNull(v.promoCode) &&
    textOrNull(v.approvedAt) &&
    count(v.referralCount) &&
    count(v.points) &&
    isRecord(v.rank) &&
    isRank(v.rank.current) &&
    isRank(v.rank.next) &&
    (v.team === null ||
      (isRecord(v.team) &&
        text(v.team.id) &&
        text(v.team.name) &&
        count(v.team.memberCount) &&
        typeof v.team.isOwner === 'boolean')) &&
    Array.isArray(v.tasks) &&
    v.tasks.every(
      (t) =>
        isRecord(t) &&
        text(t.id) &&
        text(t.title) &&
        text(t.description) &&
        count(t.points) &&
        text(t.status) &&
        textOrNull(t.reviewNote) &&
        textOrNull(t.submittedAt),
    ) &&
    Array.isArray(v.recentReferrals) &&
    v.recentReferrals.every(
      (r) => isRecord(r) && text(r.name) && textOrNull(r.institution) && text(r.createdAt),
    )
  );
}

const pickRank = (r: AmbassadorOverview['rank']['current']) =>
  r && { name: r.name, minPoints: r.minPoints };

/** The panel's data, field by field. Pure, for node --test. */
export function pickOverview(o: AmbassadorOverview): AmbassadorOverview {
  return {
    promoCode: o.promoCode,
    approvedAt: o.approvedAt,
    referralCount: o.referralCount,
    points: o.points,
    rank: { current: pickRank(o.rank.current), next: pickRank(o.rank.next) },
    team: o.team && {
      id: o.team.id,
      name: o.team.name,
      memberCount: o.team.memberCount,
      isOwner: o.team.isOwner,
    },
    tasks: o.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      points: t.points,
      status: t.status,
      reviewNote: t.reviewNote,
      submittedAt: t.submittedAt,
    })),
    recentReferrals: o.recentReferrals.map((r) => ({
      name: r.name,
      institution: r.institution,
      createdAt: r.createdAt,
    })),
  };
}

const isRow = (v: unknown): v is AdminAmbassadorRow =>
  isRecord(v) &&
  text(v.userId) &&
  text(v.name) &&
  text(v.email) &&
  text(v.promoCode) &&
  textOrNull(v.approvedAt) &&
  text(v.createdAt) &&
  count(v.referralCount) &&
  count(v.points) &&
  textOrNull(v.rankName) &&
  typeof v.demo === 'boolean';

const isRowPage = (v: unknown): v is Paginated<AdminAmbassadorRow> =>
  isRecord(v) &&
  Array.isArray(v.items) &&
  v.items.every(isRow) &&
  count(v.page) &&
  count(v.pageSize) &&
  count(v.total);

/**
 * GET /ambassador/me refused with 403 although the session lets this user open the panel: the session's role is read
 * from the database (GET /auth/me), the API's guard reads the access token, and a token issued before an admin's
 * approval still says "student" until it is renewed (at most the access TTL, 15 minutes). The panel renews it once
 * through /refresh, whose loop guard ends at /login. A blocked account (also 403 here) fails the renewal: /login.
 */
export function isRoleBehind(error: unknown): boolean {
  return error instanceof DataRequestError && error.status === 403;
}

const isBoardRow = (v: unknown): v is AmbassadorLeaderboardRow =>
  isRecord(v) &&
  count(v.rank) &&
  text(v.name) &&
  textOrNull(v.institution) &&
  count(v.points) &&
  textOrNull(v.tier) &&
  typeof v.isMe === 'boolean';

const isBoard = (v: unknown): v is AmbassadorLeaderboard =>
  isRecord(v) &&
  Array.isArray(v.items) &&
  v.items.every(isBoardRow) &&
  count(v.page) &&
  count(v.pageSize) &&
  count(v.total) &&
  (v.me === null || (isRecord(v.me) && count(v.me.rank) && count(v.me.points))) &&
  text(v.asOf);

export function studentAmbassador(
  get: ApiGet,
): Pick<DataSource['student'], 'getAmbassador' | 'getAmbassadorLeaderboard'> {
  return {
    /** GET /ambassador/me (role ambassador). */
    async getAmbassador() {
      return pickOverview(await getJson(get, '/ambassador/me', isOverview));
    },
    /** GET /ambassador/leaderboard (role ambassador): no id or contact ever reaches the page. */
    async getAmbassadorLeaderboard(query) {
      const board = await getJson(
        get,
        withQuery('/ambassador/leaderboard', { page: query.page, pageSize: query.pageSize }),
        isBoard,
      );
      return {
        items: board.items.map((r) => ({
          rank: r.rank,
          name: r.name,
          institution: r.institution,
          points: r.points,
          tier: r.tier,
          isMe: r.isMe,
        })),
        page: board.page,
        pageSize: board.pageSize,
        total: board.total,
        me: board.me && { rank: board.me.rank, points: board.me.points },
        asOf: board.asOf,
      };
    },
  };
}

const isPointsConfig = (v: unknown): v is AmbassadorPointsConfig =>
  isRecord(v) &&
  count(v.pointsPerReferral) &&
  Array.isArray(v.thresholds) &&
  v.thresholds.every((t) => isRecord(t) && text(t.name) && count(t.minPoints));

export function adminAmbassadors(
  get: ApiGet,
): Pick<DataSource['admin'], 'listAmbassadors' | 'getAmbassadorPoints'> {
  return {
    /** GET /admin/ambassador-points (admin): what the referral sweep and the ranks use now. */
    async getAmbassadorPoints() {
      const c = await getJson(get, '/admin/ambassador-points', isPointsConfig);
      return {
        pointsPerReferral: c.pointsPerReferral,
        thresholds: c.thresholds.map((t) => ({ name: t.name, minPoints: t.minPoints })),
      };
    },
    /** GET /admin/ambassadors (admin): counts and points derived on the server. */
    async listAmbassadors(query) {
      const page = await getJson(
        get,
        withQuery('/admin/ambassadors', {
          page: query.page,
          pageSize: query.pageSize,
          q: query.q,
          sort: query.sort === 'points' ? 'points' : undefined,
        }),
        isRowPage,
      );
      return {
        items: page.items.map((r) => ({
          userId: r.userId,
          name: r.name,
          email: r.email,
          promoCode: r.promoCode,
          approvedAt: r.approvedAt,
          createdAt: r.createdAt,
          referralCount: r.referralCount,
          points: r.points,
          rankName: r.rankName,
          demo: r.demo,
        })),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    },
  };
}
