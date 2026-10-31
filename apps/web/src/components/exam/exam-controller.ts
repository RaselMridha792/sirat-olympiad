import {
  AUTO_SUBMIT_JITTER_SECONDS,
  CHECKPOINT_INTERVAL_SECONDS,
  EXAM_EVENTS_MAX,
  type AnswerList,
  type AttemptView,
  type CheckpointBody,
  type CheckpointResult,
  type ClientEndReason,
  type ExamEvent,
  type ExamEventType,
  type SubmissionReceipt,
  type SubmitBody,
  type SubmitResult,
} from '@sirat/shared';
import { clearExam, readExam, writeExam, type KeyValueStore } from './exam-storage.ts';

/*
 * The exam player's logic (RULEBOOK 7.1; EXAM-PLAN 3.4–3.8, 3.15), without React or the DOM so node --test drives it
 * with a fake clock. Every change is saved in the browser at once; checkpoints go every 60–120 s (and once shortly
 * before time-up, and right after a violation); time-up and the 6th violation submit the CURRENT answers; the one
 * submit is retried with the same request id until a receipt arrives. The server decides every time and every rule;
 * this only follows its answers.
 */

export interface ExamApi {
  checkpoint(attemptId: string, body: CheckpointBody): Promise<CheckpointResult>;
  submit(attemptId: string, body: SubmitBody): Promise<SubmitResult>;
}

/** What a failed request means here (lib/api errors are mapped by the caller). */
export type RequestFailure =
  | { kind: 'retry'; afterMs: number | null } // offline, 429, 5xx: try again
  | { kind: 'refused'; code: string | null } // 4xx with a reason code: do not repeat
  | { kind: 'expired' }; // the session is over: keep everything, the student logs in again

export interface ExamDeps {
  api: ExamApi;
  store: KeyValueStore | null;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** In [0, 1). */
  random(): number;
  uuid(): string;
  classify(error: unknown): RequestFailure;
}

export type PlayerPhase = 'running' | 'warning' | 'ending' | 'submitted' | 'closed';
export type Connection = 'saved' | 'saving' | 'unsaved' | 'offline';

export interface PlayerState {
  phase: PlayerPhase;
  answers: AnswerList;
  violationCount: number;
  /** After this many warnings the next violation ends the exam (owner Q4). */
  warnings: number;
  lastViolation: 'leave' | 'devtools' | null;
  connection: Connection;
  /** Local-clock time of ends_at, re-synced from every server answer. */
  endsAt: number;
  endReason: ClientEndReason | null;
  receipt: SubmissionReceipt | null;
  /** Why the exam closed without a receipt here: `time_over`, `already_submitted`, `session`. */
  closedReason: string | null;
}

const SECOND = 1000;
const BACKOFF_MS = [2, 4, 8, 16, 30].map((s) => s * SECOND);
const PRE_END_CHECKPOINT_S = { min: 30, max: 60 };

export class ExamController {
  private readonly attemptId: string;
  private readonly startedAt: number;
  private seq: number;
  private events: ExamEvent[];
  private pending: { requestId: string; endReason: ClientEndReason; answers: AnswerList } | null;
  private state: PlayerState;
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Map<string, unknown>();
  private checkpointing = false;
  private submitting = false;
  private submitTries = 0;
  private readonly deps: ExamDeps;

  constructor(view: AttemptView, deps: ExamDeps, durationSeconds: number) {
    this.deps = deps;
    this.attemptId = view.attemptId;
    const offset = Date.parse(view.serverNow) - deps.now();
    const endsAt = Date.parse(view.endsAt) - offset;
    this.startedAt = endsAt - durationSeconds * SECOND;

    const local = readExam(deps.store, view.attemptId);
    const serverSeq = view.savedSeq ?? -1;
    const useLocal = local !== null && local.seq >= serverSeq;
    const blank = view.questions.map(() => null);
    this.seq = Math.max(local?.seq ?? 0, view.savedSeq ?? 0);
    this.events = local?.events ?? [];
    this.pending = local?.pending ?? null;
    this.state = {
      phase:
        view.phase === 'submitted'
          ? 'submitted'
          : view.phase === 'time_over'
            ? 'closed'
            : 'running',
      answers: useLocal ? local.answers : (view.answers ?? blank),
      violationCount: Math.max(local?.violationCount ?? 0, view.violationCount),
      warnings: view.violationWarnings,
      lastViolation: null,
      connection: 'saved',
      endsAt,
      endReason: this.pending?.endReason ?? null,
      receipt: view.receipt,
      closedReason: view.phase === 'time_over' ? 'time_over' : null,
    };
    if (local !== null || view.savedSeq !== null) this.events.push(this.event('resume'));
  }

  /** Starts the timers; a pending submit or a count already past the warnings submits at once. */
  start(): void {
    if (this.state.phase !== 'running') return;
    this.persist();
    if (this.pending) return void this.submit(this.pending.endReason);
    if (this.state.violationCount > this.state.warnings) return void this.submit('violations');
    this.scheduleCheckpoint();
    this.scheduleEnd();
  }

  getState(): PlayerState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** One answer change: saved in the browser at once, sent with the next checkpoint. */
  answer(index: number, position: number | null): void {
    if (!this.answering()) return;
    const answers = [...this.state.answers];
    answers[index] = position;
    this.seq += 1;
    this.set({ answers, connection: 'unsaved' });
    this.persist();
  }

  /** A violation (owner Q4): a warning, or the end of the exam after the last warning. */
  violation(kind: 'leave' | 'devtools'): void {
    if (!this.answering()) return;
    const violationCount = this.state.violationCount + 1;
    this.events.push(this.event(kind));
    this.set({ violationCount, lastViolation: kind });
    this.persist();
    if (violationCount > this.state.warnings) return void this.submit('violations');
    this.set({ phase: 'warning' });
    void this.checkpoint(); // the server keeps the count even if the answers are refused as too soon
  }

  dismissWarning(): void {
    if (this.state.phase === 'warning') this.set({ phase: 'running' });
  }

  /** Events that are recorded but never count: coming back, and the network going and coming. */
  note(type: Extract<ExamEventType, 'return' | 'offline' | 'online'>): void {
    if (this.state.phase === 'submitted' || this.state.phase === 'closed') return;
    this.events.push(this.event(type));
    this.persist();
    if (type === 'offline') this.set({ connection: 'offline' });
    if (type === 'online') {
      if (this.pending) void this.submit(this.pending.endReason);
      else void this.checkpoint();
    }
  }

  /** The student pressed Submit and confirmed. */
  finish(): void {
    if (this.answering()) void this.submit('submitted');
  }

  /** Stops the timers (the page is leaving). Subscribers unsubscribe themselves; start() may run again. */
  destroy(): void {
    this.destroyTimersOnly();
  }

  /** Seconds until `endsAt` (local-clock time, re-synced from the server) by the local clock: for display only. */
  remainingSeconds(endsAt: number = this.state.endsAt): number {
    return Math.max(0, Math.ceil((endsAt - this.deps.now()) / SECOND));
  }

  async checkpoint(): Promise<void> {
    if (this.checkpointing || !this.answering()) return;
    this.checkpointing = true;
    const sentSeq = this.seq;
    this.set({ connection: 'saving' });
    try {
      const result = await this.deps.api.checkpoint(this.attemptId, {
        seq: sentSeq,
        answers: this.state.answers,
        violationCount: this.state.violationCount,
        events: this.events.slice(0, EXAM_EVENTS_MAX),
      });
      this.resync(result.remainingSeconds);
      this.set({
        violationCount: Math.max(this.state.violationCount, result.violationCount),
        connection: (result.savedSeq ?? -1) >= this.seq ? 'saved' : 'unsaved',
      });
      this.persist();
    } catch (error) {
      const failure = this.deps.classify(error);
      if (failure.kind === 'refused' && failure.code === 'already_submitted')
        this.close('already_submitted');
      else if (failure.kind === 'refused' && failure.code === 'time_over')
        void this.submit('time_up'); // the server will refuse it too, and say so
      else
        this.set({
          connection: failure.kind === 'retry' && failure.afterMs !== null ? 'unsaved' : 'offline',
        });
    } finally {
      this.checkpointing = false;
    }
  }

  private answering(): boolean {
    return this.state.phase === 'running' || this.state.phase === 'warning';
  }

  /** Time-up and the 6th violation submit the CURRENT answers; the student's Submit too. */
  private async submit(reason: ClientEndReason): Promise<void> {
    if (this.state.phase === 'submitted' || this.state.phase === 'closed') return;
    this.pending ??= {
      requestId: this.deps.uuid(),
      endReason: reason,
      answers: [...this.state.answers],
    };
    this.set({ phase: 'ending', endReason: this.pending.endReason });
    this.persist();
    this.clearTimer('checkpoint');
    this.clearTimer('preEnd');
    this.clearTimer('end');
    if (this.submitting) return;
    this.submitting = true;
    try {
      const receipt = await this.deps.api.submit(this.attemptId, {
        requestId: this.pending.requestId,
        answers: this.pending.answers,
        endReason: this.pending.endReason,
        violationCount: this.state.violationCount,
        events: this.events.slice(0, EXAM_EVENTS_MAX),
      });
      clearExam(this.deps.store, this.attemptId);
      this.pending = null;
      this.set({ phase: 'submitted', receipt, connection: 'saved' });
      this.destroyTimersOnly();
    } catch (error) {
      const failure = this.deps.classify(error);
      if (failure.kind === 'refused' && failure.code === 'time_over') {
        // Too late: the server submits the last checkpoint itself (owner Q3). The local copy has no use any more.
        clearExam(this.deps.store, this.attemptId);
        this.close('time_over');
      } else if (failure.kind === 'expired') {
        this.close('session'); // the pending submit stays saved: after logging in, the page sends it again
      } else {
        const delay =
          failure.kind === 'retry' && failure.afterMs !== null
            ? failure.afterMs
            : BACKOFF_MS[Math.min(this.submitTries, BACKOFF_MS.length - 1)]!;
        this.submitTries += 1;
        this.set({ connection: 'offline' });
        this.setTimer('submitRetry', () => void this.submit(this.pending!.endReason), delay);
      }
    } finally {
      this.submitting = false;
    }
  }

  private scheduleCheckpoint(): void {
    const { min, max } = CHECKPOINT_INTERVAL_SECONDS;
    const delay = (min + this.deps.random() * (max - min)) * SECOND;
    this.setTimer(
      'checkpoint',
      () => {
        void this.checkpoint();
        if (this.answering()) this.scheduleCheckpoint();
      },
      delay,
    );
  }

  /** One checkpoint 30–60 s before the end (a fresh server copy), then time-up and the jittered auto-submit. */
  private scheduleEnd(): void {
    const left = this.state.endsAt - this.deps.now();
    const { min, max } = PRE_END_CHECKPOINT_S;
    const preEnd = left - (min + this.deps.random() * (max - min)) * SECOND;
    if (preEnd > 0) this.setTimer('preEnd', () => void this.checkpoint(), preEnd);
    this.setTimer('end', () => this.timeUp(), Math.max(0, left));
  }

  private timeUp(): void {
    if (!this.answering()) return;
    this.pending = {
      requestId: this.deps.uuid(),
      endReason: 'time_up',
      answers: [...this.state.answers],
    };
    this.set({ phase: 'ending', endReason: 'time_up' });
    this.persist();
    this.clearTimer('checkpoint');
    this.clearTimer('preEnd');
    const { min, max } = AUTO_SUBMIT_JITTER_SECONDS;
    const jitter = (min + this.deps.random() * (max - min)) * SECOND; // spreads the time-up burst
    this.setTimer('autoSubmit', () => void this.submit('time_up'), jitter);
  }

  /** The server's remaining seconds win; small differences are ignored so the timer does not jump. */
  private resync(remainingSeconds: number): void {
    const endsAt = this.deps.now() + remainingSeconds * SECOND;
    if (Math.abs(endsAt - this.state.endsAt) <= 1500) return;
    this.set({ endsAt });
    this.clearTimer('end');
    this.clearTimer('preEnd');
    if (this.answering()) this.scheduleEnd();
  }

  private close(reason: string): void {
    this.set({ phase: 'closed', closedReason: reason });
    this.destroyTimersOnly();
  }

  private event(type: ExamEventType): ExamEvent {
    const at = Math.round((this.deps.now() - this.startedAt) / SECOND);
    return { type, at: Math.min(7200, Math.max(0, at)) };
  }

  private persist(): void {
    if (this.state.phase === 'submitted') return;
    writeExam(this.deps.store, this.attemptId, {
      seq: this.seq,
      answers: this.state.answers,
      violationCount: this.state.violationCount,
      events: this.events,
      pending: this.pending,
    });
  }

  private set(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setTimer(name: string, fn: () => void, ms: number): void {
    this.clearTimer(name);
    this.timers.set(
      name,
      this.deps.setTimer(() => {
        this.timers.delete(name);
        fn();
      }, ms),
    );
  }

  private clearTimer(name: string): void {
    const handle = this.timers.get(name);
    if (handle !== undefined) this.deps.clearTimer(handle);
    this.timers.delete(name);
  }

  private destroyTimersOnly(): void {
    for (const handle of this.timers.values()) this.deps.clearTimer(handle);
    this.timers.clear();
  }
}
