import type {
  AdminExamDetail,
  AdminLeaderboardRow,
  LeaderboardRow,
  PageQuery,
  StudentExamCard,
} from './dashboard';
import type { ExamStatus, QuestionOption, QuestionRecord } from './records';
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
  /** The student's own attempt (its id opens the review once results are published). */
  attempt: {
    attemptId: string;
    phase: AttemptPhase;
    endsAt: string;
    receipt: SubmissionReceipt | null;
  } | null;
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
  /** E7b: the newest answer-key correction, or null when the exam has none. */
  keyCorrectedAt: string | null;
  /** Scored attempts not yet re-scored after the newest correction: Build waits until this is 0. */
  rescorePending: number;
  /** The snapshot was built before the newest correction: Publish waits for a new Build. */
  snapshotStale: boolean;
  /** The newest correction and what its re-scoring changed (null while it is still pending). */
  lastCorrection: {
    position: number;
    fromKey: string;
    toKey: string;
    attempts: number | null;
    changed: number | null;
  } | null;
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

/** GET /admin/exams/:id/attempts filters (q: name or email). */
export interface AdminAttemptQuery extends PageQuery {
  status?: AttemptStatus;
  endReason?: EndReason;
  /** At least this many violations (owner Q4). */
  minViolations?: number;
}

export const EXAM_RESULTS_REFUSALS = [
  'window_open',
  'attempts_unfinished',
  'no_snapshot',
  'results_published',
  'rescore_pending',
  'snapshot_stale',
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
  /** E7b: the answer-key corrections, newest first (empty for a draft). */
  keyCorrections: AnswerKeyCorrectionView[];
};

/*
 * Answer-key correction (E7b): a published question's key changed after attempts were taken. The question row stays
 * as it was; the newest correction's key is the key everywhere a key is read, and a re-scoring job brings the scores
 * in line. Admin only; refused while results are published (unpublish first).
 */
export interface AnswerKeyCorrectionInput {
  toKey: string;
  /** 3–200 characters, kept in the record and the audit row. */
  reason: string;
  /** The exam's concurrency token, as for every exam write. */
  expectedUpdatedAt: string;
}
/**
 * GET /admin/exams/:id/preview (admins only; D2): one sample draw, exactly as a student's start would draw and show
 * it, with nothing written (no attempt, no checkpoint, no cache). Each request is a new draw. Carries the correct
 * positions, so it is an admin shape like AdminExamView and never reaches a student route.
 */
export interface AdminExamPreview {
  examId: string;
  title: string;
  status: ExamStatus;
  durationMinutes: number;
  questionsPerAttempt: number;
  violationWarnings: number;
  /** Texts only, in the drawn order. Fewer than questionsPerAttempt only for a draft whose pool is short. */
  questions: Array<{ text: string; options: string[] }>;
  /** The correct option's displayed position per question, with the key in effect (E7b corrections included). */
  correct: number[];
}

/** A correction's reason, trimmed (KeyCorrectionDto; the CHECK answer_key_corrections_reason_check). */
export const KEY_CORRECTION_LIMITS = { reasonMin: 3, reasonMax: 200 } as const;

export interface AnswerKeyCorrectionView {
  id: string;
  questionId: string;
  /** The question's admin position, for "question 7". */
  position: number;
  fromKey: string;
  toKey: string;
  reason: string;
  createdAt: string;
  createdByName: string;
}

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
  'exam_draft',
  'results_published',
  'question_not_in_exam',
  'same_key',
  'key_unknown',
] as const;
export type ExamAdminRefusal = (typeof EXAM_ADMIN_REFUSALS)[number];

/*
 * CSV question import (E7a): POST /admin/exams/:id/questions/import?dryRun=true|false, multipart field `file`.
 * All rows or none: one problem anywhere and nothing is written.
 */

export const QUESTION_IMPORT_LIMITS = {
  /** Bytes of the file (UTF-8; a BOM is allowed). Above it the API answers 413. */
  maxBytes: 1_000_000,
  /** Data rows, after the header and without blank rows. */
  maxRows: 500,
  /** Problems listed in one answer; `truncated` says there were more. */
  maxErrors: 200,
} as const;

/** The header row, in this order (letters and names compared without case). */
export const QUESTION_IMPORT_COLUMNS = [
  'text',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'correct',
  'explanation',
  'keep_order',
] as const;

/** Where a problem is: a column of the header, `row` for the whole row, `file` for the whole file. */
export type QuestionImportField = (typeof QUESTION_IMPORT_COLUMNS)[number] | 'row' | 'file';

/**
 * C0 control characters and DEL, except tab and line feed. None belongs in a question, and Postgres refuses U+0000 in
 * text and jsonb (a 500 instead of a row error). The CSV import, QuestionDto and KeyCorrectionDto refuse them.
 */
export const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const QUESTION_IMPORT_CODES = [
  'not_utf8',
  'empty',
  'too_many_rows',
  'bad_quote',
  'unterminated_quote',
  'header',
  'column_count',
  'required',
  'too_long',
  'gap',
  'correct_key_missing',
  'invalid_boolean',
  'control_character',
  'duplicate_in_file',
  'duplicate_in_exam',
] as const;
export type QuestionImportCode = (typeof QUESTION_IMPORT_CODES)[number];

/** `row` counts records as a spreadsheet shows them: the header is row 1. 0 means the whole file. */
export interface QuestionImportError {
  row: number;
  field: QuestionImportField;
  code: QuestionImportCode;
}

/** Dry run, 200. Nothing is written; `errors` empty means the import would succeed now. */
export interface QuestionImportPreview {
  rows: number;
  errors: QuestionImportError[];
  truncated: boolean;
}

/** Import, 201. With any problem: 400 `QUESTION_IMPORT_INVALID`, the errors in `details`, nothing written. */
export interface QuestionImportResult {
  created: number;
}
