import type { SessionTwoFactor } from '@sirat/shared';
import type { Answer } from './auth-errors.ts';

/**
 * Admin two-factor login on the web (06-API "Two-factor login"; DECISIONS "Admin two-factor login"). Pure, so node
 * --test covers every branch. The API decides everything; these only pick the screen and the bn/en text.
 */

/** The page where an admin or manager enrols, and the only admin page open before the code is proved. */
export const TWO_FACTOR_PAGE = '/admin/security';

/** An admin or manager whose session has not proved the code: every admin page but enrolment answers 403. */
export function needsTwoFactor(twoFactor: SessionTwoFactor | undefined): boolean {
  return !!twoFactor && twoFactor.required && !twoFactor.verified;
}

/** A 6-digit authenticator code as typed (spaces and dashes allowed, e.g. "123 456"), or null when it is not one. */
export function totpFrom(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * A recovery code as typed (XXXXX-XXXXX in base32, any case, spaces or dash), or null. The API normalises it again
 * (recovery-codes.ts).
 */
export function recoveryCodeFrom(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z2-7]{10}$/.test(compact) ? `${compact.slice(0, 5)}-${compact.slice(5)}` : null;
}

export type CodeStepProblem =
  | { kind: 'wrongCode' }
  | { kind: 'expired' }
  | { kind: 'locked'; minutes: number }
  | { kind: 'busy' }
  | { kind: 'network' };

/**
 * POST /auth/2fa/verify. 401 TWO_FACTOR_CHALLENGE_INVALID: the sign-in step is over (expired, used or used up), so
 * the form goes back to the password. A 429 is the account lock only when the API says so (as in loginProblem);
 * nginx's flood guard answers 429 with Retry-After: 1.
 */
export function codeStepProblem(answer: Answer | null): CodeStepProblem {
  if (!answer) return { kind: 'network' };
  const { status, body, retryAfter } = answer;
  if (status === 401 && body?.code === 'TWO_FACTOR_CHALLENGE_INVALID') return { kind: 'expired' };
  if (status === 401 || status === 400) return { kind: 'wrongCode' };
  if (status === 429) {
    const lock = body?.message?.startsWith('Too many attempts') || (retryAfter ?? 0) >= 60;
    return lock
      ? { kind: 'locked', minutes: Math.max(1, Math.ceil((retryAfter ?? 60) / 60)) }
      : { kind: 'busy' };
  }
  return status >= 500 ? { kind: 'busy' } : { kind: 'network' };
}

export type StepUpProblem =
  | 'wrongPassword'
  | 'wrongCode'
  | 'setupAgain'
  | 'alreadyOn'
  | 'notOn'
  | 'tooMany'
  | 'unavailable'
  | 'failed';

/** The signed-in 2FA routes (setup, enable, recovery-codes, disable): 400 for a wrong password or code, never 401. */
export function stepUpProblem(answer: Answer | null): StepUpProblem {
  if (!answer) return 'failed';
  const { status, body } = answer;
  switch (body?.code) {
    case 'PASSWORD_INCORRECT':
      return 'wrongPassword';
    case 'TWO_FACTOR_CODE_INVALID':
      return 'wrongCode';
    case 'TWO_FACTOR_SETUP_REQUIRED':
      return 'setupAgain';
    case 'TWO_FACTOR_ALREADY_ENABLED':
      return 'alreadyOn';
    case 'TWO_FACTOR_NOT_ENABLED':
      return 'notOn';
    case 'TWO_FACTOR_UNAVAILABLE':
      return 'unavailable';
  }
  if (status === 429) return 'tooMany';
  // A malformed code or password the DTO refused (400 without a code above): the code is what users mistype.
  if (status === 400) return 'wrongCode';
  return 'failed';
}

/**
 * The secret of an otpauth:// link, grouped in fours for typing it into an app by hand (when the QR code cannot be
 * scanned). Null when the link has no plausible base32 secret.
 */
export function manualKeyFrom(otpauthUri: string): string | null {
  let secret: string | null;
  try {
    const url = new URL(otpauthUri);
    if (url.protocol !== 'otpauth:') return null;
    secret = url.searchParams.get('secret');
  } catch {
    return null;
  }
  if (!secret || !/^[A-Z2-7]+=*$/i.test(secret)) return null;
  return (
    secret
      .replace(/=+$/, '')
      .toUpperCase()
      .match(/.{1,4}/g)
      ?.join(' ') ?? null
  );
}

/** GET /auth/2fa. */
export interface TwoFactorStatus {
  enabled: boolean;
  pending: boolean;
  required: boolean;
  verified: boolean;
  recoveryCodesRemaining: number;
}

export function isTwoFactorStatus(value: unknown): value is TwoFactorStatus {
  const v = value as Partial<TwoFactorStatus> | null;
  return (
    !!v &&
    typeof v.enabled === 'boolean' &&
    typeof v.pending === 'boolean' &&
    typeof v.required === 'boolean' &&
    typeof v.verified === 'boolean' &&
    typeof v.recoveryCodesRemaining === 'number'
  );
}

/** The roles the two-factor requirement may name (the API's TWO_FACTOR_ROLES). */
export const REQUIRABLE_ROLES = ['admin', 'manager'] as const;
export type RequirableRole = (typeof REQUIRABLE_ROLES)[number];

/** GET /admin/security/two-factor-requirement (admins only). */
export interface TwoFactorRequirement {
  roles: RequirableRole[];
  /** When it last changed (ISO); null while the server's default applies. */
  updatedAt: string | null;
  /** Two-factor login is on on this server. */
  available: boolean;
}

export function isTwoFactorRequirement(value: unknown): value is TwoFactorRequirement {
  const v = value as Partial<TwoFactorRequirement> | null;
  return (
    !!v &&
    Array.isArray(v.roles) &&
    v.roles.every((r) => (REQUIRABLE_ROLES as readonly unknown[]).includes(r)) &&
    (v.updatedAt === null || typeof v.updatedAt === 'string') &&
    typeof v.available === 'boolean'
  );
}

/** The ticked roles in the API's order, without duplicates. */
export function requirementRoles(ticked: { admin: boolean; manager: boolean }): RequirableRole[] {
  return REQUIRABLE_ROLES.filter((role) => ticked[role]);
}

/** A reason as the API takes it (3-200 characters on one line), or null. */
export function requirementReasonFrom(input: string): string | null {
  const reason = input.trim().replace(/\s+/g, ' ');
  return reason.length >= 3 && reason.length <= 200 ? reason : null;
}

export type RequirementProblem = 'wrongCode' | 'stale' | 'tooMany' | 'failed';

/**
 * PUT /admin/security/two-factor-requirement. The form checks the code's shape and the reason before sending, so a
 * 400 is the code itself; a 409 means someone changed the requirement since the page loaded (reload and check).
 */
export function requirementProblem(answer: Answer | null): RequirementProblem {
  if (!answer) return 'failed';
  const { status, body } = answer;
  if (body?.code === 'TWO_FACTOR_CODE_INVALID') return 'wrongCode';
  if (status === 409) return 'stale';
  if (status === 429) return 'tooMany';
  return 'failed';
}
