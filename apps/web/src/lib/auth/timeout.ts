/** A signal that aborts after `ms`: AbortSignal.timeout where the browser has it, else a plain timer. */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  // Browsers with Web Locks but without AbortSignal.timeout (e.g. Chrome 94-102): the limit still holds.
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}
