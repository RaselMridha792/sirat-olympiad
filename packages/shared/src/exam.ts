import type { AdminExamDetail } from './dashboard';
import type { QuestionOption, QuestionRecord } from './records';
import type { Category } from './index';

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
