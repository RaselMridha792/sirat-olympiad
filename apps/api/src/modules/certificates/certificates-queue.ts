import type { ConfigService } from '@nestjs/config';
import type { JobsOptions } from 'bullmq';
import type { CertificateType } from '@sirat/shared';
import type { EnvVars } from '../../config/env';

/** Certificates on the queue Redis (core C6c): issuing now, the PDF render later (C6c-2). Jobs run in the worker. */
export const CERTIFICATES_QUEUE = 'certificates';
/** CERTIFICATES_QUEUE, or CERTIFICATES_QUEUE_NAME (tests give each run its own, as for the other queues). */
export const certificatesQueueName = (config: ConfigService<EnvVars, true>): string =>
  config.get('CERTIFICATES_QUEUE_NAME', { infer: true }) || CERTIFICATES_QUEUE;

export const CERTIFICATE_JOBS = { issue: 'issue' } as const;

/** Ids only: a winner's email never reaches Redis (the API resolved the emails to ids). */
export interface IssueJobData {
  type: CertificateType;
  roundId: string;
  /** Winners only. */
  userIds?: string[];
  /** The admin who asked: the audit row's actor. */
  requestedBy: string;
}

/** 3 tries from 30 s apart; a failed job is kept 7 days, so ops-check sees it. Issuing is idempotent. */
export const CERTIFICATE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 86_400 },
};
