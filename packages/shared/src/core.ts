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

/** GET /admin/ambassadors `sort`: the newest profile first (default), or the most points first. */
export const AMBASSADOR_LIST_SORTS = ['newest', 'points'] as const;
export type AmbassadorListSort = (typeof AMBASSADOR_LIST_SORTS)[number];

// ───────────── Ambassador leaderboard (core A4; 06-API "Ambassadors") ─────────────

/**
 * One ambassador on the leaderboard: the name and institution as the exam board shows them (OPEN-QUESTIONS #10), the
 * points and the tier. No id, contact, code or referral list.
 */
export interface AmbassadorLeaderboardRow {
  /** Equal points share a rank (1, 2, 2, 4). */
  rank: number;
  name: string;
  institution: string | null;
  points: number;
  /** The highest rank threshold the points reach; null below the lowest. */
  tier: string | null;
  /** The caller's own row. */
  isMe: boolean;
}

/** GET /ambassador/leaderboard: one page of the ranking, and the caller's own place on it. */
export interface AmbassadorLeaderboard {
  items: AmbassadorLeaderboardRow[];
  page: number;
  pageSize: number;
  total: number;
  /** The caller's rank and points even when they are not on this page; null while not ranked. */
  me: { rank: number; points: number } | null;
  /** When the ranking was computed: it is cached for up to a minute. */
  asOf: string;
}

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
  /** Demo data: a demo task goes only to demo ambassadors and a real task only to real ones (nothing assigned). */
  'task_side_mismatch',
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
  /** A demo task (demo data): marked in the admin list; it goes only to demo ambassadors. */
  demo: boolean;
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
  /** A demo task's proof (demo data): marked in the queue. */
  demo: boolean;
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
  /** A demo team (its owner is a demo account): marked in the admin list, never mixed with real teams. */
  demo: boolean;
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
  /** Demo data: no round is added and no promotion runs while demo rounds exist (remove the demo data first). */
  'demo_rounds_present',
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
  /** A demo round (demo data): marked in the admin list, removed with the demo data. */
  demo: boolean;
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

// ───────────── Video and jury (core C6b) ─────────────

/**
 * Hosts a student's video link may point to (owner Q4b default: YouTube and Google Drive). The server refuses any
 * other; the jury's page makes a link only for these (lead), and never embeds a video in v1.
 */
export const VIDEO_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'drive.google.com',
] as const;

export const JURY_LIMITS = {
  videoUrlMax: 500,
  commentMax: 1000,
  /** Jury-role accounts offered in the admin's assignment form. */
  candidatesMax: 200,
} as const;

/**
 * An https link whose host is exactly one of VIDEO_HOSTS: the only kind a student may send. The host part allows
 * letters, digits, dots and hyphens only, so a user name (`@`), a port (`:`), a backslash or a space never gets
 * through; after the host only a path, query or fragment without spaces may follow.
 */
const VIDEO_URL = /^https:\/\/([A-Za-z0-9.-]+)(?:[/?#]\S*)?$/;

export function isAllowedVideoUrl(value: string): boolean {
  if (value.length > JURY_LIMITS.videoUrlMax) return false;
  const host = VIDEO_URL.exec(value)?.[1]?.toLowerCase();
  return host !== undefined && (VIDEO_HOSTS as readonly string[]).includes(host);
}

/** Refusal codes in ApiError.details for the video and the jury. */
export const JURY_REFUSALS = [
  'not_video_round',
  'window_not_open',
  'window_closed',
  'entry_closed',
  'bad_video_url',
  'not_jury',
  'window_open',
  'already_promoted',
  'bad_scores',
  /** Demo data: a demo judge goes only on a demo round and a real judge only on a real one. */
  'jury_side_mismatch',
] as const;
export type JuryRefusal = (typeof JURY_REFUSALS)[number];

/** PUT /rounds/:id/video. */
export interface VideoSubmitRequest {
  url: string;
}

/** One judge's share of a video round, for admins. */
export interface JuryAssignmentRow {
  id: string;
  judge: { userId: string; name: string; email: string };
  category: Category;
  createdAt: string;
}

/** GET /admin/rounds/:id/jury: the round's judges and the jury-role accounts that can be added. */
export interface AdminRoundJury {
  /** `demo`: a demo round, whose judges and candidates are demo accounts only (demo data). */
  round: Pick<RoundRecord, 'id' | 'name'> & { demo: boolean };
  assignments: JuryAssignmentRow[];
  candidates: Array<{ userId: string; name: string; email: string }>;
}

/** POST /admin/rounds/:id/jury: one judge for one or more categories (one row each). */
export interface JuryAssignRequest {
  judgeId: string;
  categories: Category[];
}

export interface JuryAssignResult {
  assigned: number;
  alreadyAssigned: number;
}

/** GET /jury/rounds: the video rounds a judge scores in, with their own counts. */
export interface JuryRound {
  id: string;
  name: string;
  closesAt: string | null;
  /** The window has closed: the videos no longer change and scoring is open (until a category is promoted). */
  scoringOpen: boolean;
  criteria: RoundCriterion[];
  categories: Category[];
  /** Sent videos in the judge's categories that this judge has not scored, and has. */
  pending: number;
  evaluated: number;
}

/** GET /jury/entries: blind (lead, Q4c default): an entry number, the category and the link; never a name. */
export interface JuryEntryRow {
  entryId: string;
  /** A short number to talk about an entry, e.g. "E-3FA9C1D2". */
  code: string;
  category: Category;
  videoUrl: string;
  videoSubmittedAt: string;
  /** This judge's latest score of the entry. */
  myScore: {
    criteria: Record<string, number>;
    total: number;
    comment: string | null;
    scoredAt: string;
  } | null;
}

export interface JuryEntryQuery extends PageQuery {
  round: string;
  status?: 'pending' | 'evaluated';
}

/** POST /jury/entries/:entryId/scores: every criterion of the round, 0–10 each. */
export interface JuryScoreRequest {
  criteria: Record<string, number>;
  comment?: string;
}

export interface JuryScoreResult {
  entryId: string;
  /** This score out of 100: the sum scaled by the number of criteria (with ten, the plain sum). */
  total: number;
  /** The entry's score: the average of each judge's latest total. */
  score: number;
  judges: number;
}

// ───────────── Certificates (core C6c) ─────────────

/**
 * participation: on a published Round 1 snapshot; promotion: an entry in a round after Round 1; winner: an admin
 * names final-round students (owner Q4 defaults).
 */
export const CERTIFICATE_TYPES = ['participation', 'promotion', 'winner'] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

export const CERTIFICATE_LIMITS = {
  reasonMin: 3,
  reasonMax: 200,
  /** Winners named in one request. */
  winnersMax: 50,
  /** The public check per IP and minute. */
  checksPerMinute: 30,
} as const;

/** The verification code as printed: 12 hex digits (any letter case when typed). */
export const CERTIFICATE_CODE_PATTERN = /^[0-9A-Fa-f]{12}$/;

/** Refusal codes in ApiError.details for certificates. */
export const CERTIFICATE_REFUSALS = [
  'wrong_round',
  'results_not_published',
  'no_winners',
  'unknown_user',
  'not_in_round',
  'already_revoked',
  'stale',
  'queue_unavailable',
  /** Demo data: a demo round's certificates come with the demo data, never from an issue run. */
  'demo_round',
] as const;
export type CertificateRefusal = (typeof CERTIFICATE_REFUSALS)[number];

/** POST /admin/certificates/issue: queues one job; `emails` and `reason` for winners only. */
export interface CertificateIssueRequest {
  type: CertificateType;
  roundId: string;
  emails?: string[];
  reason?: string;
}

/** 202: the job is queued; `candidates` is how many would get one now (those who have one already are skipped). */
export interface CertificateIssueResult {
  queued: true;
  type: CertificateType;
  roundId: string;
  candidates: number;
}

/** GET /certificates/mine: the student's own certificates. */
export interface MyCertificate {
  id: string;
  type: CertificateType;
  round: Pick<RoundRecord, 'id' | 'name'>;
  serial: string;
  verificationCode: string;
  nameOnCertificate: string;
  issuedAt: string;
  revoked: boolean;
}

/** GET /admin/certificates: one row, with the student's contact (admins only). */
export interface AdminCertificateRow {
  id: string;
  user: { userId: string; name: string; email: string };
  type: CertificateType;
  round: Pick<RoundRecord, 'id' | 'name'>;
  serial: string;
  nameOnCertificate: string;
  issuedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  updatedAt: string;
  /** A demo account's certificate (demo serials SLO-YYYY-9NNNNN): marked in the admin list. */
  demo: boolean;
}

export interface AdminCertificateQuery extends PageQuery {
  /** A name (contains) or a serial (exact). */
  q?: string;
  type?: CertificateType;
  round?: string;
}

/** POST /admin/certificates/:id/revoke. */
export interface CertificateRevokeRequest {
  reason: string;
  expectedUpdatedAt: string;
}

/** GET /certificates/verify/:code (public, lead): the name and the award only; revoked and unknown are both 404. */
export interface CertificateCheck {
  name: string;
  award: { type: CertificateType; roundName: string };
  /**
   * A demo certificate (demo data, DECISIONS 2026-11-08): the page says it is not a real award, so a client demo
   * works and nobody reads it as genuine (lead, 2026-11-09).
   */
  demo: boolean;
}
