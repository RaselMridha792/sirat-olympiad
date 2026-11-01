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

// ───────────── Audit log viewer (06-API "Audit log"; lead 2026-11-01) ─────────────

/** `action`: one exact action (`auth.login_failed`) or a family (`auth.*`). Lower case, dots, underscores. */
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z_]*(\.[a-z_]+)*(\.\*)?$/;

/** The filters of the audit list, shared by the list (query string) and the export (JSON body). */
export interface AdminAuditFilters {
  action?: string;
  /** An account's email, or `system` for rows written without an actor. */
  actor?: string;
  /** Asia/Dhaka calendar days (YYYY-MM-DD), both included. */
  from?: string;
  to?: string;
}

export interface AdminAuditQuery extends AdminAuditFilters {
  /** The cursor from the previous page's `next` (older rows). */
  before?: string;
  limit?: number;
}

/** One row of the list: never the IP, an email or the meta (an admin opens the row for those). */
export interface AdminAuditRow {
  id: string;
  createdAt: string;
  action: string;
  /** Written without an actor (a job, the gateway, an unknown email). */
  system: boolean;
  /** The acting account, or null for a system row. */
  actor: { name: string; role: Role } | null;
  entityType: string | null;
  entityId: string | null;
}

export interface AdminAuditPage {
  items: AdminAuditRow[];
  /** Cursor for the next (older) page; null on the last page. */
  next: string | null;
}

/** GET /admin/audit/:id: the row as written. */
export type AdminAuditDetail = AdminAuditRow & {
  ip: string | null;
  actorEmail: string | null;
  meta: unknown;
};

export interface AdminAuditExportRequest extends AdminAuditFilters {
  /** Why the trail leaves the system; kept in the export's own audit row. */
  reason: string;
}

export const ADMIN_AUDIT_EXPORT = {
  /** More matching rows than this: 400 too_many_rows (narrow the filter). */
  maxRows: 50_000,
  /** Exports per admin per hour. */
  perHour: 5,
  /** The list's page size: default and most. */
  pageSize: 25,
  maxPageSize: 50,
} as const;

// ───────────── Ambassador tasks (core C5b-2; 06-API "Ambassadors") ─────────────

export const TASK_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  descriptionMax: 2_000,
  pointsMax: 1_000,
  proofMax: 1_000,
  noteMin: 3,
  noteMax: 500,
  /** Ambassadors per assign call. */
  assignMax: 50,
  /** Proof submissions per ambassador per 10 minutes (on top of the per-user API limit). */
  submitsPer10Min: 10,
} as const;

/** Refusal codes in ApiError.details for tasks and their review. */
export const TASK_REFUSALS = [
  'stale',
  'archived',
  'not_archived',
  'nothing_to_update',
  'not_ambassador',
  'not_open',
  'not_submitted',
] as const;
export type TaskRefusal = (typeof TASK_REFUSALS)[number];

export interface AdminTaskInput {
  title: string;
  description: string;
  points: number;
}

/** PATCH /admin/tasks/:id: any of the fields, and the version the admin saw. */
export type AdminTaskPatch = Partial<AdminTaskInput> & { expectedUpdatedAt: string };

export const TASK_LIST_STATUSES = ['active', 'archived'] as const;
export type TaskListStatus = (typeof TASK_LIST_STATUSES)[number];

export interface AdminTaskQuery extends PageQuery {
  status?: TaskListStatus;
}

/** One task in the admin list, with its assignments counted by status. */
export interface AdminTaskRow {
  id: string;
  title: string;
  description: string;
  points: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: Record<'assigned' | 'submitted' | 'approved' | 'rejected', number>;
}

/** POST /admin/tasks/:id/assign answer: new assignments, and ambassadors who had it already. */
export interface TaskAssignResult {
  assigned: number;
  alreadyAssigned: number;
}

/** One submitted proof waiting for review (admins only). The proof is shown as plain text, never as a link. */
export interface AdminTaskReviewRow {
  assignmentId: string;
  taskId: string;
  taskTitle: string;
  points: number;
  ambassador: { userId: string; name: string };
  proof: string;
  submittedAt: string;
}

/** POST /admin/task-assignments/:id/{approve,reject} answer. */
export interface TaskReviewResult {
  assignmentId: string;
  status: 'approved' | 'rejected';
  /** The ambassador's points after an approval. */
  points: number | null;
}

// ───────────── Ambassador teams (core C5b-3; 06-API "Ambassadors") ─────────────

export const TEAM_LIMITS = {
  nameMin: 3,
  nameMax: 60,
  /** Members including the owner. */
  maxMembers: 10,
  /** Join attempts per user and per IP in 10 minutes (refusals count too: the codes are short). */
  joinsPerUser: 10,
  joinsPerIp: 60,
  reasonMin: 3,
  reasonMax: 200,
} as const;

/** Refusal codes in ApiError.details for teams. */
export const TEAM_REFUSALS = [
  'already_has_team',
  'name_taken',
  'already_in_team',
  'team_full',
  'team_closed',
  'owner_cannot_leave',
  'not_in_team',
  'stale',
  'nothing_to_update',
] as const;
export type TeamRefusal = (typeof TEAM_REFUSALS)[number];

/** GET /teams/mine: the caller's own team. Members are shown by first name only (they are minors). */
export interface MyTeam {
  id: string;
  name: string;
  memberCount: number;
  isOwner: boolean;
  /** Only for the owner, who shares it. */
  joinCode: string | null;
  members: Array<{ firstName: string; isOwner: boolean }>;
}

/** One team in the admin list. */
export interface AdminTeamRow {
  id: string;
  name: string;
  owner: { userId: string; name: string };
  /** The owner is still an approved, unblocked ambassador (otherwise the team takes no new members). */
  open: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /admin/teams/:id: the members with their contact, for admins only. */
export type AdminTeamDetail = AdminTeamRow & {
  members: Array<{ userId: string; name: string; email: string; joinedAt: string }>;
};

/** PATCH /admin/teams/:id: an admin renames a team (moderation), with a reason and the version they saw. */
export interface TeamRenameRequest {
  name: string;
  reason: string;
  expectedUpdatedAt: string;
}
