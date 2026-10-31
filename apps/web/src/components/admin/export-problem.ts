import { ApiRequestError } from '../../lib/api.ts';

export type ExportProblem = 'reason' | 'tooMany' | 'limit' | 'failed';

/** Which message a refused export gets (06-API "Admin students list"). Pure, for node --test. */
export function exportProblem(error: unknown): ExportProblem {
  if (!(error instanceof ApiRequestError)) return 'failed';
  if (error.status === 429) return 'limit';
  if (error.status === 400 && Array.isArray(error.body?.details)) {
    return error.body.details.includes('too_many_rows') ? 'tooMany' : 'reason';
  }
  return 'failed';
}
