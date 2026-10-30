/**
 * Rejects if `promise` has not settled within `ms`. The timer is always cleared.
 * The rejection is deferred to `setImmediate`: after an event-loop stall the timer and an already-received reply
 * are both due, and Node runs timers before I/O callbacks. Deferring lets the pending reply settle first, so a busy
 * process is not mistaken for a hung dependency (which made the rate limiter fail open and trip its breaker).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => setImmediate(() => reject(new Error(`timed out after ${ms} ms`))), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
