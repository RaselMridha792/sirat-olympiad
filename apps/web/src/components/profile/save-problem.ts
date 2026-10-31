import { ApiRequestError } from '../../lib/api.ts';

export type SaveProblem = 'phoneTaken' | 'failed';

/** What a refused profile save means for the form (06-API "Student profile"). Pure, for node --test. */
export function saveProblem(error: unknown): SaveProblem {
  if (
    error instanceof ApiRequestError &&
    error.status === 409 &&
    error.body?.code === 'PHONE_REGISTERED'
  )
    return 'phoneTaken';
  return 'failed';
}
