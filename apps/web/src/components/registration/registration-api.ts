import type {
  CurrentRegistration,
  StartRegistrationInput,
  StartRegistrationResult,
} from '@sirat/shared';
import { api } from '@/lib/api';
import { timeoutSignal } from '@/lib/auth/timeout';

/*
 * The registration calls the browser makes (same origin, through api(): the `sirat_reg` cookie travels with them,
 * and every POST carries X-Requested-With). None of them needs a session. They are never made from the Next server:
 * the cookie's path is /api/registrations, so only the browser has it.
 */

/** Start and retry run argon2 and call PayStation: allow for a slow mobile network. */
const START_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 15_000;
const post = { method: 'POST', onExpired: 'throw' } as const;

export const registrationApi = {
  start: (input: StartRegistrationInput) =>
    api<StartRegistrationResult>('/registrations/start', {
      ...post,
      body: JSON.stringify(input),
      signal: timeoutSignal(START_TIMEOUT_MS),
    }),
  current: () =>
    api<CurrentRegistration>('/registrations/current', {
      onExpired: 'throw',
      signal: timeoutSignal(READ_TIMEOUT_MS),
    }),
  resume: () =>
    api<{ paymentUrl: string }>('/registrations/current/resume', {
      ...post,
      signal: timeoutSignal(READ_TIMEOUT_MS),
    }),
  retry: () =>
    api<StartRegistrationResult>('/registrations/current/retry', {
      ...post,
      signal: timeoutSignal(START_TIMEOUT_MS),
    }),
  recheck: () =>
    api<{ requested: boolean }>('/registrations/current/recheck', {
      ...post,
      signal: timeoutSignal(READ_TIMEOUT_MS),
    }),
  cancel: () =>
    api<void>('/registrations/current/cancel', { ...post, signal: timeoutSignal(READ_TIMEOUT_MS) }),
};

/** A new id for one form submit (crypto.randomUUID where the browser has it). */
export function newStartRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Sends the browser to PayStation's checkout. Only an https URL (or the local fake's http, outside production) is
 * followed: the URL comes from our API, but a page never navigates to a scheme it did not expect.
 */
export function goToCheckout(paymentUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(paymentUrl);
  } catch {
    return false;
  }
  const allowed =
    url.protocol === 'https:' ||
    (process.env.NODE_ENV !== 'production' && url.protocol === 'http:');
  if (!allowed) return false;
  window.location.assign(url.toString());
  return true;
}
