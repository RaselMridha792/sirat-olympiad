import { ROUND_REFUSALS, type RoundRefusal } from '@sirat/shared';
import { ApiRequestError } from '../../../lib/api.ts';

export type RoundProblem = RoundRefusal | 'notFound' | 'limit' | 'invalid' | 'failed';

const KNOWN: ReadonlySet<string> = new Set(ROUND_REFUSALS);

/** Which message a refused round write gets (06-API "Rounds"): the API's code itself. Pure, for node --test. */
export function roundProblem(error: unknown): RoundProblem {
  if (!(error instanceof ApiRequestError)) return 'failed';
  if (error.status === 429) return 'limit';
  const details = Array.isArray(error.body?.details) ? (error.body.details as unknown[]) : [];
  for (const code of details)
    if (typeof code === 'string' && KNOWN.has(code)) return code as RoundRefusal;
  if (error.status === 404) return 'notFound';
  return error.status === 400 ? 'invalid' : 'failed';
}
