import {
  CATEGORIES,
  REGISTRATION_ATTEMPT_STATUSES,
  STATS_PAYMENT_STATUSES,
  type AdminStats,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, isRecord, type ApiGet } from './request.ts';

/*
 * The admin home's counts (core; 06-API "Admin statistics"). Counts only; the shape is checked and every field is
 * picked by name, so nothing the API adds later reaches the page.
 */

const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const countOrNull = (v: unknown) => v === null || count(v);
const counts = (v: unknown, keys: readonly string[]) =>
  isRecord(v) && keys.every((key) => count(v[key]));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOTALS = ['registered', 'paid', 'pendingPayments', 'activeAttempts', 'submittedAttempts'];

function isStats(v: unknown): v is AdminStats {
  return (
    isRecord(v) &&
    typeof v.asOf === 'string' &&
    counts(v.totals, TOTALS) &&
    isRecord(v.totals) &&
    countOrNull(v.totals.secondRound) &&
    countOrNull(v.totals.finalists) &&
    Array.isArray(v.registrationsDaily) &&
    v.registrationsDaily.every(
      (d) => isRecord(d) && typeof d.date === 'string' && DAY.test(d.date) && count(d.count),
    ) &&
    Array.isArray(v.byCategory) &&
    v.byCategory.every(
      (c) =>
        isRecord(c) && (CATEGORIES as readonly unknown[]).includes(c.category) && count(c.count),
    ) &&
    counts(v.registrationAttempts, REGISTRATION_ATTEMPT_STATUSES) &&
    counts(v.paymentsByStatus, STATS_PAYMENT_STATUSES) &&
    count(v.paymentsNeedingReview) &&
    counts(v.ambassadors, ['approved', 'revoked', 'referredStudents'])
  );
}

const pickCounts = <K extends string>(v: Record<K, number>, keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, v[key]])) as Record<K, number>;

/** Field by field: only what the admin home shows. */
export function pickStats(s: AdminStats): AdminStats {
  const t = s.totals;
  return {
    asOf: s.asOf,
    totals: {
      registered: t.registered,
      paid: t.paid,
      pendingPayments: t.pendingPayments,
      activeAttempts: t.activeAttempts,
      submittedAttempts: t.submittedAttempts,
      secondRound: t.secondRound,
      finalists: t.finalists,
    },
    registrationsDaily: s.registrationsDaily.map((d) => ({ date: d.date, count: d.count })),
    byCategory: s.byCategory.map((c) => ({ category: c.category, count: c.count })),
    registrationAttempts: pickCounts(s.registrationAttempts, REGISTRATION_ATTEMPT_STATUSES),
    paymentsByStatus: pickCounts(s.paymentsByStatus, STATS_PAYMENT_STATUSES),
    paymentsNeedingReview: s.paymentsNeedingReview,
    ambassadors: {
      approved: s.ambassadors.approved,
      revoked: s.ambassadors.revoked,
      referredStudents: s.ambassadors.referredStudents,
    },
  };
}

export function adminStats(get: ApiGet): Pick<DataSource['admin'], 'getStats'> {
  return {
    /** GET /admin/stats (admin, manager); the page does not call it for jury. */
    async getStats() {
      return pickStats(await getJson(get, '/admin/stats', isStats));
    },
  };
}
