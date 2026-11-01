import { ApiRequestError } from '../../../lib/api.ts';

export type Refusal<C extends string> = C | 'notFound' | 'limit' | 'invalid' | 'failed';

/**
 * Which message a refused write gets: the API's own code when it is one of `known`, else by status (core C6b, for
 * the video form, the jury's scores and the admin's jury dialog). Pure, for node --test.
 */
export function refusalOf<C extends string>(error: unknown, known: readonly C[]): Refusal<C> {
  if (!(error instanceof ApiRequestError)) return 'failed';
  if (error.status === 429) return 'limit';
  const details = Array.isArray(error.body?.details) ? (error.body.details as unknown[]) : [];
  for (const code of details)
    if (typeof code === 'string' && (known as readonly string[]).includes(code)) return code as C;
  if (error.status === 404) return 'notFound';
  return error.status === 400 ? 'invalid' : 'failed';
}
