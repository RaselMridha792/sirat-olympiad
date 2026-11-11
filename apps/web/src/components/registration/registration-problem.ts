import type { ApiError } from '@sirat/shared';
import type { RegistrationMessages } from '../../i18n/messages/registration.ts';
import type { FieldKey, InvalidKey } from './registration-form.ts';

/*
 * How the registration pages read an API refusal (06-API "Registration and payment"). Pure, for node --test. The
 * page shows only its own bn/en texts: never the API's message, a status number or a field value.
 */

/** The answer of a failed call, as ApiRequestError carries it; null when no answer came (network, timeout). */
export interface Answer {
  status: number;
  body: ApiError | null;
}

export type CodeKey = Exclude<keyof RegistrationMessages['errors'], 'invalid' | 'busy' | 'network'>;

export type RegistrationProblem =
  /** Shown next to a field (and the wizard goes back to that field's step). */
  | { kind: 'field'; field: FieldKey; text: InvalidKey | CodeKey }
  /** Shown above the button. */
  | { kind: 'form'; text: CodeKey | 'invalid' | 'busy' | 'network' }
  /** The same startRequestId was used for another email: the wizard draws a new one. */
  | { kind: 'newRequest' };

const FIELD_OF: Partial<Record<CodeKey, FieldKey>> = {
  EMAIL_REGISTERED: 'email',
  EMAIL_IN_PROGRESS: 'email',
  PHONE_REGISTERED: 'phone',
  PROMO_INVALID: 'promoCode',
  GRADE_LEVEL_UNKNOWN: 'gradeLevelId',
};

const FORM_CODES: ReadonlySet<string> = new Set<CodeKey>([
  'REGISTRATION_CLOSED',
  'PAYMENTS_UNAVAILABLE',
  'PAYMENTS_PAUSED',
  'EMAIL_REGISTERED',
  'EMAIL_IN_PROGRESS',
  'PHONE_REGISTERED',
  'PROMO_INVALID',
  'PROMO_USED_UP',
  'GRADE_LEVEL_UNKNOWN',
  'START_IN_PROGRESS',
  'PAYMENT_START_FAILED',
  'TOO_MANY_ATTEMPTS',
  'START_OVER',
]);

/** The API's password policy texts (apps/api/src/modules/auth/password-policy.ts), matched exactly. */
const PASSWORD_POLICY: Record<string, InvalidKey> = {
  'Password must be at least 8 characters': 'passwordShort',
  'Password must be at most 128 characters': 'passwordLong',
  'This password is too common. Choose another one': 'passwordCommon',
};

export function registrationProblem(answer: Answer | null): RegistrationProblem {
  if (!answer) return { kind: 'form', text: 'network' };
  const { status, body } = answer;
  const code = body?.code ?? '';
  if (code === 'START_REQUEST_REUSED') return { kind: 'newRequest' };
  if (FORM_CODES.has(code)) {
    const known = code as CodeKey;
    const field = FIELD_OF[known];
    return field ? { kind: 'field', field, text: known } : { kind: 'form', text: known };
  }
  if (status === 400) {
    const details = Array.isArray(body?.details) ? (body.details as unknown[]) : [];
    const rule = details.map((d) => PASSWORD_POLICY[String(d)]).find(Boolean);
    return rule
      ? { kind: 'field', field: 'password', text: rule }
      : { kind: 'form', text: 'invalid' };
  }
  // 429 from the IP throttle or nginx, 5xx, or an answer this page does not know: try again later.
  return { kind: 'form', text: 'busy' };
}

/** True when the start refused the promo code itself: its quote is dead, so the wizard prices it again. */
export const refusesPromoCode = (problem: RegistrationProblem): boolean =>
  problem.kind === 'field' && problem.field === 'promoCode';

/** The bn/en text of a problem's key. */
export function problemText(
  m: RegistrationMessages,
  key: InvalidKey | CodeKey | 'invalid' | 'busy' | 'network',
): string {
  return key in m.invalid
    ? m.invalid[key as InvalidKey]
    : m.errors[key as keyof RegistrationMessages['errors']];
}
