import type {
  AdminExamDetail,
  AdminLeaderboardRow,
  LeaderboardRow,
  StudentExamCard,
} from './dashboard';
import type { QuestionOption, QuestionRecord } from './records';
import type { AttemptStatus, Category, Paginated } from './index';

// ───────────── Student side (E2; EXAM-PLAN 1.1, 1.3, 3.15) ─────────────

/** After this many warnings the next rule violation ends the exam (owner, Q4: the 6th ends it). */
export const EXAM_VIOLATION_WARNINGS = 5;

/** `leave` (tab or app switch) and `devtools` are violations; the rest are only logged. `at` = seconds since start. */
export const EXAM_EVENT_TYPES = [
  'leave',
  'return',
  'devtools',
  'offline',
  'online',
  'resume',
] as const;
export type ExamEventType = (typeof EXAM_EVENT_TYPES)[number];
export const EXAM_VIOLATION_EVENTS: readonly ExamEventType[] = ['leave', 'devtools'];
export const EXAM_EVENTS_MAX = 300;
export interface ExamEvent {
  type: ExamEventType;
  at: number;
}

/** Why an exam ended (submissions.end_reason). The client may only send the first three. */
export const END_REASONS = [
  'submitted',
  'time_up',
  'violations',
  'server_checkpoint',
  'server_empty',
] as const;
export type EndReason = (typeof END_REASONS)[number];
export const CLIENT_END_REASONS = ['submitted', 'time_up', 'violations'] as const;
export type ClientEndReason = (typeof CLIENT_END_REASONS)[number];

/** Index = question position in the attempt, value = option position as displayed (null = unanswered). */
export type AnswerList = Array<number | null>;

/**
 * `time_over`: the time and the grace are over but no submission has arrived yet; the server submits the last
 * checkpoint (EXAM-PLAN 3.9).
 */
export const ATTEMPT_PHASES = ['in_progress', 'submitted', 'time_over'] as const;
export type AttemptPhase = (typeof ATTEMPT_PHASES)[number];

export interface SubmissionReceipt {
  receiptId: string;
  submittedAt: string;
  endReason: EndReason;
}

/** GET /exams. Assignable to StudentExamCard (the existing exam list page). */
export type StudentExamListItem = StudentExamCard & { resultsPublished: boolean };

/** GET /exams/:id: the waiting room. Never questions. */
export type StudentExamDetail = StudentExamListItem & {
  graceSeconds: number;
  violationWarnings: number;
  serverNow: string;
  attempt: { phase: AttemptPhase; endsAt: string; receipt: SubmissionReceipt | null } | null;
};

/** Start, resume. No question ids, no option keys, no correct answers, no explanations, no scores. */
export interface AttemptView {
  attemptId: string;
  examId: string;
  title: string;
  phase: AttemptPhase;
  serverNow: string;
  endsAt: string;
  remainingSeconds: number;
  graceSeconds: number;
  /** In this attempt's order, options as displayed; empty once submitted. */
  questions: Array<{ text: string; options: string[] }>;
  /** From the last checkpoint (null when there is none). */
  answers: AnswerList | null;
  savedSeq: number | null;
  /** The server's count: a reload or another device never starts again from 0. */
  violationCount: number;
  violationWarnings: number;
  receipt: SubmissionReceipt | null;
}

export interface CheckpointBody {
  seq: number;
  answers: AnswerList;
  violationCount: number;
  events: ExamEvent[];
}
export interface CheckpointResult {
  /** The newest checkpoint the server holds (may be newer than the one just sent). */
  savedSeq: number | null;
  violationCount: number;
  remainingSeconds: number;
  serverNow: string;
}

export interface SubmitBody {
  requestId: string;
  answers: AnswerList;
  endReason: ClientEndReason;
  violationCount: number;
  events: ExamEvent[];
}
export type SubmitResult = SubmissionReceipt & { alreadySubmitted: boolean };

/** Reason codes in `ApiError.details` on the student exam routes. */
export const EXAM_STUDENT_REFUSALS = [
  'account_blocked',
  'registration_required',
  'email_unverified',
  'not_open_yet',
  'window_closed',
  'already_submitted',
  'time_over',
  'too_soon',
  'answers_invalid',
  'violations_not_reached',
  'request_id_conflict',
  'checkpoint_unavailable',
  'results_not_published',
] as const;
export type ExamStudentRefusal = (typeof EXAM_STUDENT_REFUSALS)[number];

// ───────────── Results (E3; EXAM-PLAN 3.10–3.12, owner Q5) ─────────────

/** GET /attempts/:id/review, only after the exam's results are published. */
export interface ReviewView {
  attemptId: string;
  examId: string;
  title: string;
  endReason: EndReason;
  score: number;
  questionCount: number;
  /** From the published snapshot; null if the attempt is not in it (e.g. the account was blocked). */
  rank: number | null;
  timeTakenSeconds: number | null;
  /** In the attempt's order; positions as the student saw them. */
  questions: Array<{
    text: string;
    options: string[];
    chosen: number | null;
    correct: number;
    explanation: string | null;
  }>;
}

export type ExamLeaderboardExam = { id: string; title: string; category: Category | null };

/** GET /leaderboard?exam=: rank, name and institution only (owner Q5); empty until the results are published. */
export type ExamLeaderboard = Paginated<LeaderboardRow> & {
  exam: ExamLeaderboardExam | null;
  status: 'unpublished' | 'published';
  snapshotAt: string | null;
};

/** GET /admin/leaderboard?exam=: the snapshot with emails, scores and times, also before it is public. */
export type AdminExamLeaderboard = Paginated<AdminLeaderboardRow> & {
  exam: ExamLeaderboardExam | null;
  isPublic: boolean;
  snapshotAt: string | null;
  generation: number;
};

/** GET /admin/exams/:id/results. */
export interface ExamResultsStatus {
  examId: string;
  /** window_end + grace has passed: no attempt can still be running. */
  windowClosed: boolean;
  counts: Record<AttemptStatus, number>;
  snapshotAt: string | null;
  generation: number;
  publishedAt: string | null;
  canBuild: boolean;
  canPublish: boolean;
}

/** GET /admin/exams/:id/attempts (owner Q4: each student's violations and how the exam ended). */
export interface AdminAttemptRow {
  attemptId: string;
  userId: string;
  name: string;
  email: string;
  status: AttemptStatus;
  endReason: EndReason | null;
  violationCount: number | null;
  startedAt: string;
  endsAt: string;
  submittedAt: string | null;
  timeTakenSeconds: number | null;
  score: number | null;
}
export type AdminAttemptDetail = AdminAttemptRow & { events: ExamEvent[] };

export const EXAM_RESULTS_REFUSALS = [
  'window_open',
  'attempts_unfinished',
  'no_snapshot',
  'results_published',
] as const;
export type ExamResultsRefusal = (typeof EXAM_RESULTS_REFUSALS)[number];

// ───────────── Admin side (E1) ─────────────

/*
 * Exam engine shapes shared by the API and the web (docs/plans/EXAM-PLAN.md section 1). Admin shapes carry the
 * correct key; no student-facing shape may.
 */

/** Limits the admin form and the API check alike (the database CHECKs are the last line). */
export const EXAM_LIMITS = {
  titleMax: 200,
  questionsPerAttemptMax: 200,
  graceSecondsMax: 300,
  optionsMin: 2,
  optionsMax: 6,
  questionTextMax: 2000,
  optionTextMax: 500,
  explanationMax: 4000,
  reasonMin: 3,
  reasonMax: 200,
  /** Unpublishing is refused this close to the window start. */
  unpublishBeforeStartMinutes: 5,
} as const;

/** One version of a question, as an admin sees it (correct key included). */
export type AdminQuestion = Pick<
  QuestionRecord,
  'id' | 'text' | 'options' | 'correctKey' | 'explanation' | 'version' | 'isActive'
> & {
  lineageId: string;
  position: number;
  keepOptionOrder: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** GET /admin/exams/:id. Assignable to AdminExamDetail, so the existing admin pages keep working. */
export type AdminExamView = Omit<AdminExamDetail, 'questions'> & {
  roundId: string | null;
  randomDraw: boolean;
  contentVersion: number;
  publishedAt: string | null;
  /** The concurrency token: writes send it back as `expectedUpdatedAt`. */
  updatedAt: string;
  /** Active questions, in admin order. */
  questions: AdminQuestion[];
};

/** POST /admin/exams. Times are ISO 8601 with an explicit zone (stored UTC, shown in Asia/Dhaka). */
export interface AdminExamInput {
  title: string;
  category: Category | null;
  roundId: string | null;
  windowStart: string;
  windowEnd: string;
  durationMinutes: number;
  questionsPerAttempt: number;
  graceSeconds: number;
  randomDraw: boolean;
}

/** PATCH /admin/exams/:id. A published exam accepts only `title` and a later `windowEnd` (with `reason`). */
export type AdminExamPatch = Partial<AdminExamInput> & {
  expectedUpdatedAt: string;
  reason?: string;
};

/** POST /admin/exams/:id/questions; PUT adds `expectedUpdatedAt` (the question's). */
export interface AdminQuestionInput {
  text: string;
  options: QuestionOption[];
  correctKey: string;
  explanation: string | null;
  keepOptionOrder: boolean;
}

/** Reason codes in `ApiError.details` for refusals the admin screen tells apart (06-API "Exam admin"). */
export const EXAM_ADMIN_REFUSALS = [
  'stale',
  'exam_published',
  'exam_archived',
  'window_not_extendable',
  'question_count',
  'window_too_short',
  'window_over',
  'duplicate_question_text',
  'window_started',
  'has_attempts',
  'results_not_published',
  'pool_fixed',
  'pool_too_small',
  'not_active',
  'duplicate_option_key',
  'correct_key_missing',
  'round_not_found',
] as const;
export type ExamAdminRefusal = (typeof EXAM_ADMIN_REFUSALS)[number];
