import type { Category, Role } from './index';
import type { AdminUserQuery, AnnouncementItem, PageQuery } from './dashboard';
import type { AnnouncementRecord, EntryStatus, RoundRecord, RoundType } from './records';

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

// ───────────── Rounds and promotion (core C6a) ─────────────

export const ROUND_LIMITS = {
  nameMin: 2,
  nameMax: 60,
  /** Rounds in all, Round 1 included (rounds_sort_order_check). */
  maxRounds: 10,
  criteriaMin: 1,
  criteriaMax: 20,
  criterionKeyMax: 40,
  criterionLabelMax: 80,
  /** Points a judge gives per criterion (0 to this). */
  criterionMax: 10,
  topNMax: 25_000,
} as const;

/** A criterion key: lower case, digits and underscores, starting with a letter. */
export const CRITERION_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

/** Refusal codes in ApiError.details for rounds and promotion. */
export const ROUND_REFUSALS = [
  'stale',
  'nothing_to_update',
  'after_final',
  'too_many_rounds',
  'bad_window',
  'bad_criteria',
  'window_started',
  'window_shortened',
  'window_closed',
  'quiz_round',
  'not_video_round',
  'criteria_frozen',
  'no_next_round',
  'no_exam',
  'ambiguous_source',
  'results_not_published',
  'window_not_closed',
  'unscored_entries',
  'no_entries',
  'already_promoted',
] as const;
export type RoundRefusal = (typeof ROUND_REFUSALS)[number];

/** One jury criterion of a video round; the labels are shown to judges in both languages. */
export interface RoundCriterion {
  key: string;
  en: string;
  bn: string;
}

/** The old Zero Olympiad's ten criteria (0–10 each, total 0–100): a new video round's default (owner Q4 default). */
export const DEFAULT_VIDEO_CRITERIA: readonly RoundCriterion[] = [
  { key: 'content_relevance', en: 'Content Relevance', bn: 'বিষয়বস্তুর প্রাসঙ্গিকতা' },
  { key: 'creativity', en: 'Creativity and Innovation', bn: 'সৃজনশীলতা ও উদ্ভাবন' },
  { key: 'clarity', en: 'Clarity and Communication', bn: 'স্পষ্টতা ও যোগাযোগ' },
  { key: 'impact', en: 'Impact and Call to Action', bn: 'প্রভাব ও কাজের আহ্বান' },
  { key: 'presentation', en: 'Presentation and Visual Appeal', bn: 'উপস্থাপনা ও দৃশ্যমান আকর্ষণ' },
  { key: 'technical_quality', en: 'Technical Quality', bn: 'কারিগরি মান' },
  { key: 'research', en: 'Research and Data Usage', bn: 'গবেষণা ও তথ্যের ব্যবহার' },
  { key: 'engagement', en: 'Engagement and Storytelling', bn: 'আকর্ষণ ও গল্প বলা' },
  { key: 'inclusivity', en: 'Inclusivity and Diversity', bn: 'অন্তর্ভুক্তি ও বৈচিত্র্য' },
  { key: 'overall', en: 'Overall Learning and Execution', bn: 'সামগ্রিক শিক্ষা ও বাস্তবায়ন' },
];

/** One promotion out of a round, per category. */
export interface AdminPromotionRun {
  id: string;
  category: Category;
  toRoundId: string;
  topN: number;
  promoted: number;
  eliminated: number;
  createdAt: string;
}

/** GET /admin/rounds (all rounds, at most 10, in order) and GET /admin/rounds/:id. */
export type AdminRound = Pick<
  RoundRecord,
  'id' | 'name' | 'sortOrder' | 'type' | 'opensAt' | 'closesAt'
> & {
  /** Video rounds only. */
  criteria: RoundCriterion[] | null;
  /** A jury score exists, so the criteria can no longer change. */
  scored: boolean;
  /** This round's entries by status. */
  entries: Record<EntryStatus, number>;
  promotions: AdminPromotionRun[];
  createdAt: string;
  updatedAt: string;
};

/** POST /admin/rounds: Round 1 (quiz) exists; admins add video and final rounds after it, in order. */
export interface RoundCreateRequest {
  name: string;
  type: Exclude<RoundType, 'quiz'>;
  /** Required for a video round (the submission window); optional for a final round (both or neither). */
  opensAt?: string;
  closesAt?: string;
  /** Video rounds; DEFAULT_VIDEO_CRITERIA when left out. */
  criteria?: RoundCriterion[];
}

/** PATCH /admin/rounds/:id: the fields sent change; `expectedUpdatedAt` is the version the admin saw. */
export interface RoundUpdateRequest {
  name?: string;
  opensAt?: string;
  closesAt?: string;
  criteria?: RoundCriterion[];
  expectedUpdatedAt: string;
}

/** The body of both promotion calls. */
export interface PromotionQuery {
  /** Everyone ranked at or above this goes through, ties at the cut included (owner Q4a default). */
  topN: number;
  category: Category;
}

/** Echoed back by the run: refused (409 `stale`) when the source changed after the preview. */
export interface PromotionExpected {
  promoted: number;
  sourceKey: string;
}

/** POST /admin/rounds/:id/promotion/preview: counts only, no names (exam's admin leaderboard has the list). */
export interface PromotionPreview {
  from: Pick<RoundRecord, 'id' | 'name' | 'type'>;
  to: Pick<RoundRecord, 'id' | 'name' | 'type'>;
  category: Category;
  topN: number;
  source:
    { kind: 'exam'; examId: string; examTitle: string; generation: number } | { kind: 'jury' };
  /** Ranked rows of this category in the source. */
  candidates: number;
  promoted: number;
  /** Promoted beyond topN because they tie with the student at the cut (lead: the admin sees why N + k). */
  tieCount: number;
  eliminated: number;
  /** The last promoted rank and its score; null when nobody would be promoted. */
  cut: { rank: number; score: number; timeTakenSeconds: number | null } | null;
  expected: PromotionExpected;
}

/** POST /admin/rounds/:id/promotion. */
export interface PromotionRequest extends PromotionQuery {
  expected: PromotionExpected;
}

export interface PromotionResult {
  runId: string;
  promoted: number;
  eliminated: number;
  toRound: Pick<RoundRecord, 'id' | 'name'>;
}

/** GET /rounds/me (student, ambassador): the student's current round and own entry. */
export interface MyRound {
  round: Pick<RoundRecord, 'id' | 'name' | 'type' | 'sortOrder' | 'opensAt' | 'closesAt'>;
  /** null: no entry yet (Round 1 before its promotion). */
  entryStatus: EntryStatus | null;
  /** The student's own video link, shown back as text (core C6b). */
  videoUrl: string | null;
  videoSubmittedAt: string | null;
}
