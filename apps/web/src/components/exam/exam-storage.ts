import type { AnswerList, ClientEndReason, ExamEvent } from '@sirat/shared';

/*
 * The browser copy of a running attempt (RULEBOOK 7.1; EXAM-PLAN 3.4, 3.15): every answer change and every rule
 * violation is written here at once, so a reload, a crash or a lost network loses nothing and the violation count
 * never starts again from 0. Answers are option positions, which tell nothing to anyone else. Keys are per attempt
 * and are removed on the receipt and on logout.
 */

export const STORAGE_PREFIX = 'sirat.exam.v1.';

export interface StoredExam {
  seq: number;
  answers: AnswerList;
  violationCount: number;
  events: ExamEvent[];
  /** A submit that has not got its receipt yet: retried with the same request id after a reload. */
  pending: { requestId: string; endReason: ClientEndReason; answers: AnswerList } | null;
}

/** The part of the Web Storage API used here (localStorage in the browser, a map in tests). */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
  readonly length: number;
  key(index: number): string | null;
};

export function readExam(store: KeyValueStore | null, attemptId: string): StoredExam | null {
  try {
    const raw = store?.getItem(STORAGE_PREFIX + attemptId);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredExam>;
    if (!Array.isArray(v.answers) || typeof v.seq !== 'number') return null;
    return {
      seq: v.seq,
      answers: v.answers,
      violationCount: typeof v.violationCount === 'number' ? v.violationCount : 0,
      events: Array.isArray(v.events) ? v.events : [],
      pending: v.pending ?? null,
    };
  } catch {
    return null; // private mode, a full disk or a damaged entry: the server copy still holds
  }
}

export function writeExam(store: KeyValueStore | null, attemptId: string, value: StoredExam): void {
  try {
    store?.setItem(STORAGE_PREFIX + attemptId, JSON.stringify(value));
  } catch {
    /* storage full or blocked: checkpoints and the submit still carry the answers */
  }
}

export function clearExam(store: KeyValueStore | null, attemptId: string): void {
  try {
    store?.removeItem(STORAGE_PREFIX + attemptId);
  } catch {
    /* nothing to clean */
  }
}

/** The attempts that have a copy in this browser. */
export function storedAttemptIds(store: KeyValueStore | null): string[] {
  if (!store) return [];
  try {
    const ids: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) ids.push(key.slice(STORAGE_PREFIX.length));
    }
    return ids;
  } catch {
    return [];
  }
}

/** After a logout: no attempt's copy stays in a shared browser. Other keys are left alone. */
export function clearAllExams(store: KeyValueStore | null): void {
  for (const attemptId of storedAttemptIds(store)) clearExam(store, attemptId);
}

export function browserStore(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
