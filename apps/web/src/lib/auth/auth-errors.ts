import type { ApiError } from '@sirat/shared';

/**
 * How the auth forms read API answers. Pure, so node --test covers every branch. Messages are matched exactly
 * against the API's fixed texts (apps/api/src/modules/auth); the forms then show their own bn/en wording.
 */
export const INVALID_LINK_MESSAGE = 'This link is invalid or has expired';
const LOCK_PREFIX = 'Too many attempts';
const POLICY: Record<string, 'tooShort' | 'tooLong' | 'tooCommon'> = {
  'Password must be at least 8 characters': 'tooShort',
  'Password must be at most 128 characters': 'tooLong',
  'This password is too common. Choose another one': 'tooCommon',
};

/** The shape of an answer the forms care about (ApiRequestError carries it). */
export interface Answer {
  status: number;
  body: ApiError | null;
  retryAfter: number | null;
}

export type LoginProblem =
  | { kind: 'wrong' }
  | { kind: 'locked'; minutes: number }
  | { kind: 'busy' }
  | { kind: 'blocked' }
  | { kind: 'invalidEmail' }
  | { kind: 'network' };

/**
 * A 429 is the account lock only when the API says so ("Too many attempts", Retry-After in minutes). nginx's flood
 * guard also answers 429 (Retry-After: 1): that is "busy, try again in a moment", not a lock.
 */
export function loginProblem(answer: Answer | null): LoginProblem {
  if (!answer) return { kind: 'network' };
  const { status, body, retryAfter } = answer;
  if (status === 401) return { kind: 'wrong' };
  if (status === 403) return { kind: 'blocked' };
  if (status === 400) return { kind: 'invalidEmail' };
  if (status === 429) {
    const lock = body?.message?.startsWith(LOCK_PREFIX) || (retryAfter ?? 0) >= 60;
    return lock
      ? { kind: 'locked', minutes: Math.max(1, Math.ceil((retryAfter ?? 60) / 60)) }
      : { kind: 'busy' };
  }
  return status >= 500 ? { kind: 'busy' } : { kind: 'network' };
}

export type LinkProblem =
  | { kind: 'badLink' }
  | { kind: 'policy'; rule: 'tooShort' | 'tooLong' | 'tooCommon' }
  | { kind: 'tooMany' }
  | { kind: 'busy' }
  | { kind: 'network' };

/** reset-password and verify-email: a bad link is recognised by its exact message only. */
export function linkProblem(answer: Answer | null): LinkProblem {
  if (!answer) return { kind: 'network' };
  const { status, body } = answer;
  if (status === 400 && body?.message === INVALID_LINK_MESSAGE) return { kind: 'badLink' };
  if (status === 400 && Array.isArray(body?.details)) {
    const rule = (body.details as unknown[]).map((d) => POLICY[String(d)]).find(Boolean);
    if (rule) return { kind: 'policy', rule };
  }
  if (status === 429) return { kind: 'tooMany' };
  return status >= 500 ? { kind: 'busy' } : { kind: 'network' };
}

/** The token of an emailed link (`/reset-password#token=...`): 32 random bytes as base64url, always 43 characters. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function linkTokenFrom(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get('token');
  return token && TOKEN.test(token) ? token : null;
}

/**
 * The page's token after reading the address bar's `hash`. The first read decides (no token: null). Later, only a
 * new emailed link (a hash with `token=`, opened in the same tab without a reload) replaces it; any other hash,
 * like an in-page anchor, keeps it. `strip`: remove the hash from the address bar.
 */
export function readLinkToken(
  current: string | null | undefined,
  hash: string,
): { token: string | null; strip: boolean } {
  if (current !== undefined && !/[#&]token=/.test(hash)) return { token: current, strip: false };
  return { token: linkTokenFrom(hash), strip: hash !== '' };
}
