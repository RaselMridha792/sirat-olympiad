/**
 * @sirat/shared — types and constants used by BOTH apps/web and apps/api.
 * Rule: no runtime dependencies, no secrets, no business logic that decides money/time/score.
 */

export const ROLES = ['student', 'ambassador', 'manager', 'jury', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const CATEGORIES = ['activist', 'ambassador', 'achiever'] as const;
export type Category = (typeof CATEGORIES)[number];

export const PAYMENT_STATUSES = [
  'initiated',
  'pending',
  'paid',
  'failed',
  'expired',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ATTEMPT_STATUSES = ['in_progress', 'submitted', 'expired', 'scored'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** Hard product limits (see docs/RULEBOOK.md section 7.1). */
export const EXAM_MAX_DURATION_MINUTES = 30;
export const CHECKPOINT_INTERVAL_SECONDS = { min: 60, max: 120 } as const;
export const AUTO_SUBMIT_JITTER_SECONDS = { min: 0, max: 20 } as const;
/** Pre-fill for the admin exam form only. The server reads exams.grace_seconds (per exam) and nothing else. */
export const SUBMIT_GRACE_SECONDS_DEFAULT = 30;

/** Standard API error shape returned by the global exception filter. */
export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

/** Standard paginated list shape. Every list endpoint returns this. */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

// Schema mirrors and the dashboard response contract (web data layer + API).
export * from './records';
export * from './dashboard';
export * from './phone';
