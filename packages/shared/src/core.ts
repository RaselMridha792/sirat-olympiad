import type { AdminUserQuery } from './dashboard';

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
