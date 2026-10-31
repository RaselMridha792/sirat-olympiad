import type { Category, Paginated, Role } from './index';
import type {
  AdminTaskRecord,
  AmbassadorProfileRecord,
  AnnouncementRecord,
  AttemptRecord,
  ExamRecord,
  ExamStatus,
  GradeLevelRecord,
  PaymentRecord,
  QuestionRecord,
  RankThresholdRecord,
  RoundEntryRecord,
  RoundRecord,
  TaskAssignmentRecord,
  TeamRecord,
  UserRecord,
} from './records';

/*
 * Response contract of the dashboard screens. Every shape is built from the schema mirrors in
 * records.ts (Pick<...>) plus a few values only the server can compute (state, rank, counts).
 * The web app reads them through apps/web/src/data (mock today, the real API later); the API
 * implements the same types, so neither side invents its own.
 *
 * Identity is never a parameter: the API takes the acting user from the session cookie.
 */

/** 1-based page. The server clamps pageSize; `q` is a trimmed search string. */
export interface PageQuery {
  page: number;
  pageSize: number;
  q?: string;
}

export type AnnouncementItem = Pick<AnnouncementRecord, 'id' | 'title' | 'body' | 'publishedAt'>;

// ───────────── Student ─────────────

/** Decided by the server from its clock, the exam window and the student's attempt. */
export const STUDENT_EXAM_STATES = [
  'upcoming',
  'open',
  'in_progress',
  'submitted',
  'closed',
] as const;
export type StudentExamState = (typeof STUDENT_EXAM_STATES)[number];

export type StudentExamCard = Pick<
  ExamRecord,
  | 'id'
  | 'title'
  | 'category'
  | 'durationMinutes'
  | 'questionsPerAttempt'
  | 'windowStart'
  | 'windowEnd'
> & { state: StudentExamState };

export interface StudentHome {
  user: Pick<UserRecord, 'name' | 'category'>;
  /** The round the student is in now, with their entry status; null before Round 1 starts. */
  currentRound:
    | (Pick<RoundRecord, 'id' | 'name' | 'type' | 'sortOrder'> & {
        entryStatus: RoundEntryRecord['status'] | null;
      })
    | null;
  /** Next open or upcoming exam; rules on the home page are rendered from its config. */
  nextExam: (StudentExamCard & Pick<ExamRecord, 'graceSeconds'>) | null;
  latestAnnouncements: AnnouncementItem[];
}

export type StudentProfile = Pick<
  UserRecord,
  | 'name'
  | 'email'
  | 'phone'
  | 'district'
  | 'institution'
  | 'educationType'
  | 'category'
  | 'role'
  | 'emailVerifiedAt'
  | 'createdAt'
> & {
  gradeLevel: Pick<GradeLevelRecord, 'id' | 'label'> | null;
  currentRound: Pick<RoundRecord, 'id' | 'name'> | null;
};

/**
 * PATCH /users/me allow-list (RULEBOOK §18; core plan Q1). role, category, email, grade, points and payment
 * fields are never client-writable: an admin corrects the grade (and so the category) before the first exam.
 * Every field is optional; the ones sent must be valid (none of them can be cleared).
 */
export const PROFILE_UPDATE_FIELDS = [
  'name',
  'phone',
  'district',
  'institution',
  'educationType',
] as const;
export type ProfileField = (typeof PROFILE_UPDATE_FIELDS)[number];
export type ProfileUpdate = Partial<Record<ProfileField, string>>;
/** `taken`: the phone belongs to another account or to a registration in progress (owner's rule). */
export type ProfileFieldError = 'required' | 'tooLong' | 'tooShort' | 'invalid' | 'taken';
/** The same limits as the registration form (payments' StartRegistrationDto). */
export const PROFILE_LIMITS = {
  name: { min: 2, max: 100 },
  institution: { min: 2, max: 150 },
} as const;
export type ProfileUpdateResult =
  | { ok: true }
  | { ok: false; fieldErrors: Partial<Record<keyof ProfileUpdate, ProfileFieldError>> };

/** Option lists for the profile form come from the server (grade table, education types, districts). */
export interface ProfileOptions {
  gradeLevels: Pick<GradeLevelRecord, 'id' | 'label' | 'category'>[];
  educationTypes: string[];
  districts: string[];
}

export interface AmbassadorOverview {
  /** null until an admin approves the ambassador and a code is assigned. */
  promoCode: AmbassadorProfileRecord['promoCode'] | null;
  approvedAt: AmbassadorProfileRecord['approvedAt'];
  /** Counted from users.referred_by_id rows, never a stored counter. */
  referralCount: number;
  /** Sum of the point ledger. */
  points: number;
  rank: {
    current: Pick<RankThresholdRecord, 'name' | 'minPoints'> | null;
    next: Pick<RankThresholdRecord, 'name' | 'minPoints'> | null;
  };
  team: (Pick<TeamRecord, 'id' | 'name'> & { memberCount: number; isOwner: boolean }) | null;
  tasks: Array<
    Pick<AdminTaskRecord, 'id' | 'title' | 'description' | 'points'> &
      Pick<TaskAssignmentRecord, 'status'>
  >;
  /** Latest referred students (no contact details). */
  recentReferrals: Array<Pick<UserRecord, 'name' | 'institution' | 'createdAt'>>;
}

// ───────────── Leaderboard (precomputed snapshot) ─────────────

export type LeaderboardRound = Pick<RoundRecord, 'id' | 'name' | 'type' | 'sortOrder'>;

export interface LeaderboardQuery extends PageQuery {
  roundId?: string;
}

/** Student view: rank, name, institution, status. No score, time or email (OPEN-QUESTIONS #10). */
export type LeaderboardRow = Pick<UserRecord, 'name' | 'institution'> & {
  rank: number;
  entryStatus: RoundEntryRecord['status'] | null;
};

export type LeaderboardView<Row> =
  | { status: 'unpublished'; rounds: LeaderboardRound[]; round: LeaderboardRound | null }
  | ({
      status: 'published';
      rounds: LeaderboardRound[];
      round: LeaderboardRound;
      /** When the snapshot was computed (after the window closed). */
      snapshotAt: string;
    } & Paginated<Row>);

export type AdminLeaderboardRow = LeaderboardRow &
  Pick<UserRecord, 'email' | 'category'> & {
    userId: UserRecord['id'];
    score: AttemptRecord['score'];
    timeTakenSeconds: AttemptRecord['timeTakenSeconds'];
  };

export interface AdminLeaderboardQuery extends LeaderboardQuery {
  category?: Category;
}

/** Admins see the snapshot before it is public (settings.leaderboard_public). */
export type AdminLeaderboardView = Paginated<AdminLeaderboardRow> & {
  isPublic: boolean;
  rounds: LeaderboardRound[];
  round: LeaderboardRound | null;
  snapshotAt: string | null;
};

// ───────────── Admin ─────────────

/** Cached aggregate (refreshed by a job), never a full-table scan per request. */
export interface AdminStats {
  asOf: string;
  totals: {
    registered: number;
    paid: number;
    pendingPayments: number;
    activeAttempts: number;
    submittedAttempts: number;
    secondRound: number;
    finalists: number;
  };
  /** Last 45 days, oldest first; `date` is a calendar day in Asia/Dhaka (YYYY-MM-DD). */
  registrationsDaily: Array<{ date: string; count: number }>;
  byCategory: Array<{ category: Category; count: number }>;
}

/** The account's registration and the status of the payment behind it (payments' tables, read only). */
export interface AdminUserRegistration {
  /** registrations.created_at (ISO). */
  registeredAt: string;
  invoiceNumber: PaymentRecord['invoiceNumber'];
  paymentStatus: PaymentRecord['status'];
  paidAt: PaymentRecord['paidAt'];
}

/** One row of the admin students list (06-API "Admin students list"). Never the full phone (core plan D2). */
export type AdminUserRow = Pick<
  UserRecord,
  'id' | 'name' | 'email' | 'role' | 'isBlocked' | 'category' | 'district' | 'createdAt'
> & {
  /** The last 3 digits of the phone, or null without one. */
  phoneLast3: string | null;
  gradeLabel: GradeLevelRecord['label'] | null;
  emailVerified: boolean;
  registration: AdminUserRegistration | null;
  /** A payment of this user carries a review reason (payments' admin page has the details). */
  needsPaymentReview: boolean;
};

export type AdminUserDetail = AdminUserRow &
  Pick<UserRecord, 'phone' | 'institution' | 'educationType' | 'emailVerifiedAt'> & {
    gradeLevel: Pick<GradeLevelRecord, 'id' | 'label'> | null;
    payment: Pick<
      PaymentRecord,
      'status' | 'invoiceNumber' | 'amountMinor' | 'currency' | 'paidAt'
    > | null;
    /** The ambassador whose promo code the student used (no contact details). */
    referredBy:
      | (Pick<UserRecord, 'name'> & { promoCode: AmbassadorProfileRecord['promoCode'] | null })
      | null;
    ambassador: Pick<AmbassadorProfileRecord, 'promoCode' | 'approvedAt'> | null;
  };

export interface AdminUserQuery extends PageQuery {
  role?: Role;
  blocked?: boolean;
  category?: Category;
  /** true: has a registration; false: none (e.g. staff, or an account whose payment needs review). */
  registered?: boolean;
  verified?: boolean;
}

export type AdminExamCard = Pick<
  ExamRecord,
  | 'id'
  | 'title'
  | 'category'
  | 'status'
  | 'durationMinutes'
  | 'questionsPerAttempt'
  | 'windowStart'
  | 'windowEnd'
> & {
  questionCount: number;
  /** Published with submissions: questions can only be versioned, never edited in place. */
  locked: boolean;
};

export type AdminExamDetail = AdminExamCard &
  Pick<ExamRecord, 'graceSeconds' | 'resultsPublishedAt'> & {
    round: Pick<RoundRecord, 'id' | 'name'> | null;
    /** Admin only: includes the correct key. */
    questions: Array<
      Pick<QuestionRecord, 'id' | 'text' | 'options' | 'correctKey' | 'explanation' | 'version'>
    >;
  };

export interface AdminExamQuery extends PageQuery {
  status?: ExamStatus;
}

export type AdminAmbassadorRow = Pick<UserRecord, 'name' | 'email'> &
  Pick<AmbassadorProfileRecord, 'userId' | 'promoCode' | 'approvedAt' | 'createdAt'> & {
    referralCount: number;
    points: number;
    rankName: RankThresholdRecord['name'] | null;
  };
