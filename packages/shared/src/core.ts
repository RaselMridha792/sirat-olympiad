import type { Category } from './index';
import type { AdminUserQuery, AnnouncementItem } from './dashboard';
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
