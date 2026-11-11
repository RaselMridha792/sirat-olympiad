import { ApiRequestError } from '../../lib/api.ts';

export type ParticipantIdProblem = 'reason' | 'notFound' | 'failed';

/** Which message a refused "issue a new participant ID" gets (06-API, payments P1b). Pure, for node --test. */
export function participantIdProblem(error: unknown): ParticipantIdProblem {
  if (!(error instanceof ApiRequestError)) return 'failed';
  if (error.status === 404) return 'notFound';
  if (error.status === 400) return 'reason';
  return 'failed';
}
