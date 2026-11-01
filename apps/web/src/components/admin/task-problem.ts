import { ApiRequestError } from '../../lib/api.ts';

export type TaskProblem =
  | 'stale'
  | 'archived'
  | 'notArchived'
  | 'nothingToUpdate'
  | 'notAmbassador'
  | 'notOpen'
  | 'notSubmitted'
  | 'limit'
  | 'invalid'
  | 'failed';

const BY_CODE: Record<string, TaskProblem> = {
  stale: 'stale',
  archived: 'archived',
  not_archived: 'notArchived',
  nothing_to_update: 'nothingToUpdate',
  not_ambassador: 'notAmbassador',
  not_open: 'notOpen',
  not_submitted: 'notSubmitted',
};

/** Which message a refused task write gets (06-API "Ambassadors", tasks). Pure, for node --test. */
export function taskProblem(error: unknown): TaskProblem {
  if (!(error instanceof ApiRequestError)) return 'failed';
  if (error.status === 429) return 'limit';
  const details = Array.isArray(error.body?.details) ? (error.body.details as unknown[]) : [];
  for (const code of details) {
    const problem = typeof code === 'string' ? BY_CODE[code] : undefined;
    if (problem) return problem;
  }
  return error.status === 400 ? 'invalid' : 'failed';
}
