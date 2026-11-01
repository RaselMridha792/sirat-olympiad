/*
 * One automatic retry of a registration start the API was too busy for (503 SERVICE_BUSY: the database refused for a
 * passing reason and nothing was applied; the API's global filter). Only the start is retried this way: it is
 * idempotent by its startRequestId (a start that committed is replayed, one that rolled back starts fresh). Other
 * calls show their error state. Pure, for node --test.
 */

/** At most this long, whatever Retry-After says: the student is waiting at the button. */
export const BUSY_RETRY_CAP_SECONDS = 5;
/** When the answer has no Retry-After. */
const DEFAULT_RETRY_AFTER_SECONDS = 2;

/** The parts of ApiRequestError this needs (lib/api.ts), so this module imports nothing from Next. */
type Refusal = { status?: unknown; body?: { code?: unknown } | null; retryAfter?: unknown };

/** The wait before the retry, in ms (Retry-After, capped, plus up to 1 s of jitter); null: not a busy answer. */
export function busyRetryDelayMs(err: unknown, random: () => number = Math.random): number | null {
  const e = (err ?? null) as Refusal | null;
  if (!e || e.status !== 503 || e.body?.code !== 'SERVICE_BUSY') return null;
  const after =
    typeof e.retryAfter === 'number' && e.retryAfter > 0
      ? e.retryAfter
      : DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(after, BUSY_RETRY_CAP_SECONDS) * 1000 + Math.floor(random() * 1000);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sends; after a busy answer waits and sends the same request once more. Any other refusal is thrown as it came. */
export async function withBusyRetry<T>(
  send: () => Promise<T>,
  wait: (ms: number) => Promise<void> = sleep,
  random: () => number = Math.random,
): Promise<T> {
  try {
    return await send();
  } catch (err) {
    const delay = busyRetryDelayMs(err, random);
    if (delay === null) throw err;
    await wait(delay);
    return send();
  }
}
