/*
 * Demo data (DECISIONS 2026-11-08 "Demo data, loaded and removed with one click"). Pre-launch only: the API refuses
 * it unless DEMO_DATA_ALLOWED is on, and prelaunch-check fails while it is on or any demo row exists.
 */

// DEMO_EMAIL_DOMAIN ('demo.sirat.invalid', without '@'), isDemoEmail, DEMO_ACCOUNT_LABEL and DEMO_INVOICE_PREFIX are
// payments' (registration.ts): one definition each.

/** The reason an admin gives for loading or removing demo data (audited). */
export const DEMO_REASON_LIMITS = { min: 3, max: 200 } as const;

export const DEMO_BATCH_STATUSES = ['loading', 'loaded', 'failed', 'clearing'] as const;

/**
 * The abandoned-job rule: a batch still 'loading' or 'clearing' this long after its last change has lost its job (the
 * API stopped between the commit and the queue, or the queue lost the job; a load takes seconds, its transaction at
 * most 2 minutes). Such a batch may be removed like a failed one; a late job then finds it no longer loading and does
 * nothing.
 */
export const DEMO_STALE_MINUTES = 15;

/** Load and remove per admin per hour (each is a job over thousands of rows; a refusal counts too). */
export const DEMO_ACTIONS_PER_HOUR = 10;
export type DemoBatchStatus = (typeof DEMO_BATCH_STATUSES)[number];

/** GET /admin/demo. */
export interface AdminDemoStatus {
  /**
   * DEMO_DATA_ALLOWED on this server. Off, a load answers 409 demo_not_allowed; a removal still runs, so demo data
   * never outlives the switch.
   */
  allowed: boolean;
  /** The current batch, or null when there is no demo data. One batch at a time. */
  batch: {
    id: string;
    status: DemoBatchStatus;
    createdAt: string;
    createdByName: string;
    /** Rows per area once loaded, e.g. { students: 300, attempts: 540 }. */
    counts: Record<string, number>;
    /** 'loading' or 'clearing' past DEMO_STALE_MINUTES: the job is gone; the batch may be removed. */
    stale: boolean;
  } | null;
  /** The running job's last step, while a load or a removal runs. */
  progress: { action: DemoAction; step: string } | null;
  /** How the last load or removal ended (kept for a day), e.g. a removal refused because real rows use demo rows. */
  lastOutcome: DemoOutcome | null;
}

export type DemoAction = 'load' | 'clear';

export interface DemoOutcome {
  action: DemoAction;
  result: 'done' | 'failed' | 'blocked';
  at: string;
  /**
   * result 'blocked' (a removal only): what stops it, as counts per kind (demo_clear's names, e.g.
   * real_attempts_on_demo_exams). Nothing was removed; those real rows must go first.
   */
  blockers?: Record<string, number>;
}

/** POST /admin/demo/load and /admin/demo/clear. */
export interface DemoActionInput {
  reason: string;
}

/** POST /admin/demo/load: 202. The demo logins' one password, shown once, never stored in clear. */
export interface DemoLoadAccepted {
  batchId: string;
  password: string;
}

export const DEMO_REFUSALS = [
  'demo_not_allowed',
  'demo_exists',
  'demo_busy',
  'demo_absent',
  'payments_live',
  'real_payments',
] as const;
export type DemoRefusal = (typeof DEMO_REFUSALS)[number];
