import type { RegistrationState } from '@sirat/shared';

/*
 * How often the result page asks GET /registrations/current (plan 6.7): every 2 s at first, then 5 s, then 10 s,
 * and not at all after 2 minutes; the page then offers "Check my payment status" (a recheck), which starts the
 * schedule again. Pure, for node --test.
 */
export const POLL_STOP_MS = 2 * 60_000;

/** The wait before the next read, `elapsedMs` after the schedule started; null: stop and show the button. */
export function nextPollDelay(elapsedMs: number): number | null {
  if (elapsedMs >= POLL_STOP_MS) return null;
  if (elapsedMs < 20_000) return 2_000;
  if (elapsedMs < 60_000) return 5_000;
  return 10_000;
}

/** States that can still change on their own (the worker is confirming, or the checkout is open). */
export function isMoving(state: RegistrationState): boolean {
  return state === 'awaiting_payment' || state === 'confirming';
}
