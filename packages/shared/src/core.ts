import type { Category, Role } from './index';
import type { AdminUserQuery, AnnouncementItem, PageQuery } from './dashboard';
import type { AnnouncementRecord } from './records';

/*
 * Shapes of the core session's endpoints that are not dashboard reads (docs/plans/CORE-PLAN.md). Dashboard read
 * shapes stay in dashboard.ts.
 */

/** The list filters of GET /admin/users, without paging. */
export type AdminUserFilters = Omit<AdminUserQuery, 'page' | 'pageSize'>;

/** POST /admin/users/export (06-API "Admin students list"). */
export interface AdminUserExportRequest {
  filters: AdminUserFilters;
  /** Why the data leaves the system; kept in the audit row. */
  reason: string;
}

export const ADMIN_USER_EXPORT = {
  /** More matching rows than this: 400 too_many_rows (narrow the filter). */
  maxRows: 50_000,
  /** Exports per admin per hour. */
  perHour: 5,
  reasonMin: 3,
  reasonMax: 200,
} as const;

/** POST /admin/users/:id/grade-level: an admin corrects a student's class, and with it the category. */
export interface GradeCorrectionRequest {
  gradeLevelId: string;
  reason: string;
}

/** Refusal codes in ApiError.details for the profile and the grade correction (06-API "Student profile"). */
export const PROFILE_REFUSALS = [
  'nothing_to_update',
  'has_attempt',
  'grade_level_unknown',
  'not_a_student',
] as const;
export type ProfileRefusal = (typeof PROFILE_REFUSALS)[number];

// ───────────── Announcements (core C4; 06-API "Announcements") ─────────────

export const ANNOUNCEMENT_LIMITS = {
  title: { min: 3, max: 150 },
  body: { min: 1, max: 5000 },
} as const;

/** Derived by the server from archived_at and published_at (never stored). */
export const ANNOUNCEMENT_STATUSES = ['scheduled', 'published', 'archived'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

/** The admin view of one announcement. */
export type AdminAnnouncement = AnnouncementItem &
  Pick<AnnouncementRecord, 'category' | 'archivedAt' | 'createdAt' | 'updatedAt'> & {
    status: AnnouncementStatus;
    authorName: string | null;
  };

/** GET /admin/announcements */
export interface AdminAnnouncementQuery extends PageQuery {
  status?: AnnouncementStatus;
}

/** POST /admin/announcements; `publishAt` (ISO) defaults to now, at most 1 minute in the past. */
export interface AnnouncementInput {
  title: string;
  body: string;
  /** null = everyone */
  category: Category | null;
  publishAt?: string;
}

/** PATCH /admin/announcements/:id: `expectedUpdatedAt` is the value the form showed (409 `stale` otherwise). */
export type AnnouncementPatch = Partial<AnnouncementInput> & { expectedUpdatedAt: string };

/** Refusal codes in ApiError.details. */
export const ANNOUNCEMENT_REFUSALS = [
  'stale',
  'archived',
  'not_archived',
  'publish_in_past',
  'nothing_to_update',
] as const;
export type AnnouncementRefusal = (typeof ANNOUNCEMENT_REFUSALS)[number];

// ───────────── Ambassadors (core C5a; 06-API "Ambassadors") ─────────────

/** Refusal codes in ApiError.details for approving and revoking an ambassador. */
export const AMBASSADOR_REFUSALS = [
  'not_paid_student',
  'blocked',
  'wrong_role',
  'not_ambassador',
] as const;
export type AmbassadorRefusal = (typeof AMBASSADOR_REFUSALS)[number];

// ───────────── Admin statistics (06-API "Admin statistics"; the shape is AdminStats in dashboard.ts) ─────────────

/** payments' RegistrationAttemptStatus (schema.prisma), in the order the admin home lists them. */
export const REGISTRATION_ATTEMPT_STATUSES = [
  'open',
  'completed',
  'abandoned',
  'conflict',
] as const;
export type RegistrationAttemptStatus = (typeof REGISTRATION_ATTEMPT_STATUSES)[number];

/** The payment statuses the admin home counts: every status except `refunded`, which is never entered. */
export const STATS_PAYMENT_STATUSES = [
  'initiated',
  'pending',
  'paid',
  'failed',
  'expired',
] as const;
export type StatsPaymentStatus = (typeof STATS_PAYMENT_STATUSES)[number];

/** POST /admin/ambassadors/:userId/{approve,revoke} answer: the ambassador's state after the change. */
export interface AmbassadorState {
  userId: string;
  promoCode: string;
  approvedAt: string | null;
  role: Role;
}

// ───────────── Ambassador points (core C5b; 06-API "Ambassadors") ─────────────

export interface RankThresholdInput {
  name: string;
  minPoints: number;
}

/** GET /admin/ambassador-points: what the referral sweep and the ranks use now (owner Q3 defaults until answered). */
export interface AmbassadorPointsConfig {
  pointsPerReferral: number;
  /** Lowest first; the first starts at 0. */
  thresholds: RankThresholdInput[];
}

/** PUT /admin/ambassador-points: the new values, the values the admin saw (`expected`) and a reason. */
export interface AmbassadorPointsUpdate extends AmbassadorPointsConfig {
  expected: AmbassadorPointsConfig;
  reason: string;
}

/** POST /admin/points/adjust: a compensating ledger entry (points are never edited or deleted). */
export interface PointsAdjustRequest {
  userId: string;
  /** Positive or negative, never 0. */
  amount: number;
  reason: string;
}

export interface PointsAdjustResult {
  userId: string;
  /** The ambassador's points after the entry. */
  points: number;
}

export const AMBASSADOR_POINTS_LIMITS = {
  maxPerReferral: 1_000,
  maxThresholds: 10,
  maxMinPoints: 1_000_000,
  maxAdjust: 10_000,
  nameMin: 2,
  nameMax: 30,
  reasonMin: 3,
  reasonMax: 200,
} as const;

/** Refusal codes in ApiError.details for the points settings and adjustments. */
export const AMBASSADOR_POINTS_REFUSALS = ['stale', 'bad_thresholds', 'not_ambassador'] as const;
export type AmbassadorPointsRefusal = (typeof AMBASSADOR_POINTS_REFUSALS)[number];
