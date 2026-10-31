import type {
  AttemptView,
  CheckpointBody,
  CheckpointResult,
  SubmitBody,
  SubmitResult,
} from '@sirat/shared';
import { api, ApiRequestError, SessionExpiredError } from '../../lib/api.ts';
import type { ExamApi, RequestFailure } from './exam-controller.ts';

/*
 * The player's calls, from the browser through lib/api.ts (same origin, the httpOnly cookie, the CSRF header, one
 * session renewal after a 401). The answers and their checkpoints live in the browser (RULEBOOK 7.1), so these are
 * not Server Component reads. Server-side exam reads live in the data layer (data/http/exams.ts).
 */

const send = (body: unknown) => ({ body: JSON.stringify(body), onExpired: 'throw' as const });

export interface PlayerApi extends ExamApi {
  start(examId: string): Promise<AttemptView>;
  resume(examId: string): Promise<AttemptView>;
}

export const playerApi: PlayerApi = {
  start: (examId) =>
    api<AttemptView>(`/exams/${encodeURIComponent(examId)}/attempts`, { method: 'POST' }),
  resume: (examId) => api<AttemptView>(`/attempts/me?exam=${encodeURIComponent(examId)}`),
  checkpoint: (attemptId: string, body: CheckpointBody) =>
    api<CheckpointResult>(`/attempts/${encodeURIComponent(attemptId)}/checkpoint`, {
      method: 'PUT',
      ...send(body),
    }),
  submit: (attemptId: string, body: SubmitBody) =>
    api<SubmitResult>(`/attempts/${encodeURIComponent(attemptId)}/submit`, {
      method: 'POST',
      ...send(body),
    }),
};

/** The reason code the API put in `details` (06-API "Exam engine"), if any. */
export function refusalCode(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const details = error.body?.details;
  return Array.isArray(details) && typeof details[0] === 'string' ? details[0] : null;
}

/** Maps a failed request to what the player does next: try again, stop, or keep everything for after a login. */
export function classifyFailure(error: unknown): RequestFailure {
  if (error instanceof SessionExpiredError) return { kind: 'expired' };
  if (error instanceof ApiRequestError) {
    if (error.status === 429)
      return { kind: 'retry', afterMs: error.retryAfter === null ? null : error.retryAfter * 1000 };
    if (error.status >= 500) return { kind: 'retry', afterMs: null };
    return { kind: 'refused', code: refusalCode(error) };
  }
  return { kind: 'retry', afterMs: null }; // no answer at all: offline or a dropped connection
}

/** A v4 UUID for the submit's request id; crypto.randomUUID exists only on https and localhost. */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
