import type { ConfigService } from '@nestjs/config';
import type { JobsOptions } from 'bullmq';
import type { DemoBatchStatus } from '@sirat/shared';
import type { EnvVars } from '../../config/env';

/** Demo data on the queue Redis (DECISIONS 2026-11-08 "Demo data"): load and remove run in the worker, one at a time. */
export const DEMO_QUEUE = 'demo';
/** DEMO_QUEUE, or DEMO_QUEUE_NAME (tests give each run its own, as for the other queues). */
export const demoQueueName = (config: ConfigService<EnvVars, true>): string =>
  config.get('DEMO_QUEUE_NAME', { infer: true }) || DEMO_QUEUE;

export const DEMO_JOBS = { load: 'load', clear: 'clear' } as const;

export interface DemoLoadJobData {
  batchId: string;
  /**
   * The demo logins' argon2id hash (the API hashed the password it showed once). A hash of 16 random characters: it
   * cannot be turned back into the password, and the job is removed once it ends.
   */
  passwordHash: string;
  /** The admin who asked: the alert's actor. */
  requestedBy: string;
}

export interface DemoClearJobData {
  batchId: string;
  /** The status before 'clearing': restored when the removal is refused or fails for good. */
  previous: Extract<DemoBatchStatus, 'loaded' | 'failed'>;
  requestedBy: string;
}

/**
 * 3 tries 10 s apart. Both jobs are idempotent: a load skips what committed, a removal of a removed batch does
 * nothing. A failed job keeps its data a day only (it holds the hash), then goes.
 */
export const DEMO_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'fixed', delay: 10_000 },
  removeOnComplete: true,
  removeOnFail: { age: 86_400 },
};
