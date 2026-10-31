import { EXAM_EVENTS_MAX, type SubmitBody } from '@sirat/shared';
import { clearExam, readExam, storedAttemptIds, type KeyValueStore } from './exam-storage.ts';

/** How long a logout waits for unsent final submits (lead, 2026-10-31). */
export const LOGOUT_SUBMIT_WAIT_MS = 3000;

/**
 * Before a logout: a final submit that never got its receipt (offline, a closed tab) is sent once more, with its own
 * request id, while the session still works. The wait is bounded; whatever happens, the caller clears every copy
 * after a logout that worked, because the server's sweep finalizes the attempt from its last checkpoint anyway.
 */
export async function sendPendingSubmits(
  store: KeyValueStore | null,
  submit: (attemptId: string, body: SubmitBody) => Promise<unknown>,
  waitMs: number = LOGOUT_SUBMIT_WAIT_MS,
): Promise<void> {
  const sends: Array<Promise<void>> = [];
  for (const attemptId of storedAttemptIds(store)) {
    const saved = readExam(store, attemptId);
    if (!saved?.pending) continue;
    const body: SubmitBody = {
      requestId: saved.pending.requestId,
      answers: saved.pending.answers,
      endReason: saved.pending.endReason,
      violationCount: saved.violationCount,
      events: saved.events.slice(0, EXAM_EVENTS_MAX),
    };
    sends.push(
      submit(attemptId, body).then(
        () => clearExam(store, attemptId),
        () => undefined,
      ),
    );
  }
  if (sends.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(sends),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
    }),
  ]);
  clearTimeout(timer);
}
