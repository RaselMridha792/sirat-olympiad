import type { ConfigService } from '@nestjs/config';
import type { JobsOptions } from 'bullmq';
import type { EnvVars } from '../../config/env';

/** Nightly housekeeping on the queue Redis (LAUNCH-PLAN §9). Jobs run only in the worker. */
export const HOUSEKEEPING_QUEUE = 'housekeeping';
/** HOUSEKEEPING_QUEUE, or HOUSEKEEPING_QUEUE_NAME (tests give each run its own, as for exam and payments). */
export const housekeepingQueueName = (config: ConfigService<EnvVars, true>): string =>
  config.get('HOUSEKEEPING_QUEUE_NAME', { infer: true }) || HOUSEKEEPING_QUEUE;

export const HOUSEKEEPING_JOBS = { sessionCleanup: 'session-cleanup' } as const;
export type HousekeepingJobName = (typeof HOUSEKEEPING_JOBS)[keyof typeof HOUSEKEEPING_JOBS];

/** One scheduler id: however many workers start, one cleanup per night. 03:30 Dhaka, the quietest hour. */
export const SESSION_CLEANUP_SCHEDULER_ID = 'session-cleanup';
export const SESSION_CLEANUP_SCHEDULE = { pattern: '30 3 * * *', tz: 'Asia/Dhaka' } as const;

/** 3 tries from 1 minute apart; a failed job is kept 7 days, so ops-check sees it. */
export const HOUSEKEEPING_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 86_400 },
};
