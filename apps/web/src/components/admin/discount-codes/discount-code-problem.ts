import { ApiRequestError } from '../../../lib/api.ts';

export type DiscountCodeProblem =
  | 'CODE_INVALID'
  | 'VALUE_INVALID'
  | 'WINDOW_INVALID'
  | 'AMBASSADOR_INVALID'
  | 'CODE_TAKEN'
  | 'CODE_LOCKED'
  | 'CODE_IN_USE'
  | 'DEMO_CODE'
  | 'invalid'
  | 'failed';

const KNOWN: ReadonlySet<string> = new Set([
  'CODE_INVALID',
  'VALUE_INVALID',
  'WINDOW_INVALID',
  'AMBASSADOR_INVALID',
  'CODE_TAKEN',
  'CODE_LOCKED',
  'CODE_IN_USE',
  'DEMO_CODE',
]);

/** Which message a refused discount-code write gets (06-API "Admin discount codes"). Pure, for node --test. */
export function discountCodeProblem(error: unknown): DiscountCodeProblem {
  if (!(error instanceof ApiRequestError)) return 'failed';
  const code = error.body?.code ?? '';
  if (KNOWN.has(code)) return code as DiscountCodeProblem;
  if (error.status === 400) return 'invalid';
  return 'failed';
}
