import type { ConfigService } from '@nestjs/config';
import type { JobsOptions } from 'bullmq';
import type { EnvVars } from '../../config/env';

/** Nightly housekeeping on the queue Redis (LAUNCH-PLAN §9). Jobs run only in the worker. */
export const HOUSEKEEPING_QUEUE = 'housekeeping';
/** HOUSEKEEPING_QUEUE, or HOUSEKEEPING_QUEUE_NAME (tests give each run its own, as for exam and payments). */
export const housekeepingQueueName = (config: ConfigService<EnvVars, true>): string =>
  config.get('HOUSEKEEPING_QUEUE_NAME', { infer: true }) || HOUSEKEEPING_QUEUE;

export const HOUSEKEEPING_JOBS = {
  sessionCleanup: 'session-cleanup',
  attemptScrub: 'attempt-scrub',
} as const;
export type HousekeepingJobName = (typeof HOUSEKEEPING_JOBS)[keyof typeof HOUSEKEEPING_JOBS];

/** One scheduler id: however many workers start, one cleanup per night. 03:30 Dhaka, the quietest hour. */
export const SESSION_CLEANUP_SCHEDULER_ID = 'session-cleanup';
export const SESSION_CLEANUP_SCHEDULE = { pattern: '30 3 * * *', tz: 'Asia/Dhaka' } as const;

/**
 * The registration form's retention (PAYMENTS-PLAN 4.3, D6): its own scheduler, so a failure of one job never retries
 * the other. 04:00 Dhaka: after the session cleanup (03:30) and core's ambassador back-fill (03:45).
 */
export const ATTEMPT_SCRUB_SCHEDULER_ID = 'attempt-scrub';
export const ATTEMPT_SCRUB_SCHEDULE = { pattern: '0 4 * * *', tz: 'Asia/Dhaka' } as const;

/** Every nightly job of this queue: its scheduler id, its schedule and the job it adds. */
export const HOUSEKEEPING_SCHEDULES = [
  {
    id: SESSION_CLEANUP_SCHEDULER_ID,
    schedule: SESSION_CLEANUP_SCHEDULE,
    job: HOUSEKEEPING_JOBS.sessionCleanup,
  },
  {
    id: ATTEMPT_SCRUB_SCHEDULER_ID,
    schedule: ATTEMPT_SCRUB_SCHEDULE,
    job: HOUSEKEEPING_JOBS.attemptScrub,
  },
] as const;

/** 3 tries from 1 minute apart; a failed job is kept 7 days, so ops-check sees it. */
export const HOUSEKEEPING_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 86_400 },
};
