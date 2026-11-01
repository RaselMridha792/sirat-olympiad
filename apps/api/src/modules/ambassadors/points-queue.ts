import type { ConfigService } from '@nestjs/config';
import type { JobsOptions } from 'bullmq';
import type { EnvVars } from '../../config/env';

/** Ambassador points on the queue Redis (core C5b). Jobs run only in the worker. */
export const AMBASSADOR_QUEUE = 'ambassador-points';
/** AMBASSADOR_QUEUE, or AMBASSADOR_QUEUE_NAME (tests give each run its own, as for exam, payments and housekeeping). */
export const ambassadorQueueName = (config: ConfigService<EnvVars, true>): string =>
  config.get('AMBASSADOR_QUEUE_NAME', { infer: true }) || AMBASSADOR_QUEUE;

export const AMBASSADOR_JOBS = {
  /** Every 5 minutes: registrations of the last 2 days (the whole table on the first run). */
  referralPoints: 'referral-points',
  /** Nightly: every registration, so nothing is missed (a worker down for days, a late registration row). */
  referralBackfill: 'referral-points-backfill',
} as const;

/** One scheduler id each: however many workers start, one run per period. */
export const REFERRAL_POINTS_SCHEDULE = { every: 5 * 60_000 } as const;
export const REFERRAL_BACKFILL_SCHEDULE = { pattern: '45 3 * * *', tz: 'Asia/Dhaka' } as const;

/** 3 tries from 30 s apart; a failed job is kept 7 days, so ops-check sees it. The sweep is idempotent. */
export const AMBASSADOR_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 86_400 },
};
