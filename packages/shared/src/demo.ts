/*
 * Demo data (DECISIONS 2026-11-08 "Demo data, loaded and removed with one click"). Pre-launch only: the API refuses
 * it unless DEMO_DATA_ALLOWED is on, and prelaunch-check fails while it is on or any demo row exists.
 */

// DEMO_EMAIL_DOMAIN ('demo.sirat.invalid', without '@'), isDemoEmail, DEMO_ACCOUNT_LABEL and DEMO_INVOICE_PREFIX are
// payments' (registration.ts): one definition each.

/** The reason an admin gives for loading or removing demo data (audited). */
export const DEMO_REASON_LIMITS = { min: 3, max: 200 } as const;

export const DEMO_BATCH_STATUSES = ['loading', 'loaded', 'failed', 'clearing'] as const;
export type DemoBatchStatus = (typeof DEMO_BATCH_STATUSES)[number];

/** GET /admin/demo. */
export interface AdminDemoStatus {
  /** DEMO_DATA_ALLOWED on this server; off, load and remove answer 409 demo_not_allowed. */
  allowed: boolean;
  /** The current batch, or null when there is no demo data. One batch at a time. */
  batch: {
    id: string;
    status: DemoBatchStatus;
    createdAt: string;
    createdByName: string;
    /** Rows per area once loaded, e.g. { students: 300, attempts: 540 }. */
    counts: Record<string, number>;
  } | null;
  /** The running job's last step, while a load or a removal runs. */
  progress: { action: 'load' | 'clear'; step: string } | null;
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
