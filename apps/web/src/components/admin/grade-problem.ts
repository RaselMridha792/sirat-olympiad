import { ApiRequestError } from '../../lib/api.ts';

export type GradeProblem = 'reason' | 'hasAttempt' | 'notStudent' | 'unknown' | 'failed';

/** Which message a refused grade correction gets (06-API "Student profile"). Pure, for node --test. */
export function gradeProblem(error: unknown): GradeProblem {
  if (!(error instanceof ApiRequestError)) return 'failed';
  const details = Array.isArray(error.body?.details) ? error.body.details : [];
  if (details.includes('has_attempt')) return 'hasAttempt';
  if (details.includes('not_a_student')) return 'notStudent';
  if (details.includes('grade_level_unknown')) return 'unknown';
  if (error.status === 400) return 'reason';
  return 'failed';
}
