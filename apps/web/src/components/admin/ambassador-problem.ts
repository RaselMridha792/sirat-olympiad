import { ApiRequestError } from '../../lib/api.ts';

export type AmbassadorProblem =
  'reason' | 'notPaidStudent' | 'blocked' | 'wrongRole' | 'notAmbassador' | 'failed';

const BY_CODE: Record<string, AmbassadorProblem> = {
  not_paid_student: 'notPaidStudent',
  blocked: 'blocked',
  wrong_role: 'wrongRole',
  not_ambassador: 'notAmbassador',
};

/** Which message a refused approve or revoke gets (06-API "Ambassadors"). Pure, for node --test. */
export function ambassadorProblem(error: unknown): AmbassadorProblem {
  if (!(error instanceof ApiRequestError)) return 'failed';
  const details = Array.isArray(error.body?.details) ? (error.body.details as unknown[]) : [];
  for (const code of details) {
    const problem = typeof code === 'string' ? BY_CODE[code] : undefined;
    if (problem) return problem;
  }
  return error.status === 400 ? 'reason' : 'failed';
}
