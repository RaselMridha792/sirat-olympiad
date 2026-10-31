import { ADMIN_SETTING_LIMITS, type ApiError } from '@sirat/shared';

/*
 * The admin payment and settings forms' rules, as the API checks them (06-API "Admin payments and settings"), and
 * how their refusals are read. Pure, for node --test. The forms show only their own bn/en texts.
 */

/** The fee as the admin types it (whole taka) to paisa; null unless 10 to 10,000 whole taka. Bangla digits work too. */
export function parseFeeTaka(input: string): number | null {
  const western = input
    .trim()
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
    .replace(/,/g, '');
  if (!/^\d{1,5}$/.test(western)) return null;
  const taka = Number(western);
  if (taka < ADMIN_SETTING_LIMITS.feeMinTaka || taka > ADMIN_SETTING_LIMITS.feeMaxTaka) return null;
  return taka * 100;
}

/** The trx_id as PayStation's panel shows it (the API's ReconcilePaymentDto pattern). */
export function validTrxId(input: string): boolean {
  return /^[A-Za-z0-9._-]{6,64}$/.test(input.trim());
}

export function validReason(input: string, min: number, max: number): boolean {
  const length = input.trim().length;
  return length >= min && length <= max;
}

export interface Answer {
  status: number;
  body: ApiError | null;
}

export type ActionProblem =
  | 'SETTING_CHANGED'
  | 'RECONCILE_NOT_ALLOWED'
  | 'TRX_ID_IN_USE'
  | 'invalid'
  | 'denied'
  | 'busy'
  | 'network';

const CODES = new Set<ActionProblem>(['SETTING_CHANGED', 'RECONCILE_NOT_ALLOWED', 'TRX_ID_IN_USE']);

/** null: no answer came (network, timeout). */
export function actionProblem(answer: Answer | null): ActionProblem {
  if (!answer) return 'network';
  const code = answer.body?.code ?? '';
  if (CODES.has(code as ActionProblem)) return code as ActionProblem;
  if (answer.status === 400) return 'invalid';
  if (answer.status === 403) return 'denied';
  return 'busy';
}
