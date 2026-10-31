import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AttemptView, CheckpointBody, SubmitBody } from '@sirat/shared';
import { ExamController, type ExamDeps, type RequestFailure } from './exam-controller.ts';
import { readExam, type KeyValueStore } from './exam-storage.ts';

/*
 * The player's rules, driven with a fake clock (EXAM-PLAN 6.1 web tests; owner Q4). The main ones: the automatic
 * submits send the CURRENT answers, never an empty list; the violation count survives a reload; the 6th violation
 * submits; the submit keeps the local copy until a receipt arrives.
 */

class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

class Harness {
  time = Date.parse('2026-11-20T10:00:00Z');
  /** The server's ends_at: ten minutes after the start. */
  readonly endsAt = this.time + 10 * 60_000;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private nextId = 1;
  readonly checkpoints: CheckpointBody[] = [];
  readonly submits: SubmitBody[] = [];
  submitFailures: RequestFailure[] = [];
  checkpointFailure: RequestFailure | null = null;
  readonly store = new MemoryStore();

  deps(): ExamDeps {
    return {
      store: this.store,
      now: () => this.time,
      setTimer: (fn, ms) => {
        const id = this.nextId++;
        this.timers.push({ at: this.time + ms, fn, id });
        return id;
      },
      clearTimer: (handle) => {
        this.timers = this.timers.filter((t) => t.id !== handle);
      },
      random: () => 0.5,
      uuid: () => `req-${this.submits.length}-00000000`,
      classify: (e) => e as RequestFailure,
      api: {
        checkpoint: async (_id, body) => {
          this.checkpoints.push(body);
          if (this.checkpointFailure) throw this.checkpointFailure;
          return {
            savedSeq: body.seq,
            violationCount: body.violationCount,
            remainingSeconds: Math.max(0, Math.ceil((this.endsAt - this.time) / 1000)),
            serverNow: new Date(this.time).toISOString(),
          };
        },
        submit: async (_id, body) => {
          this.submits.push(body);
          const failure = this.submitFailures.shift();
          if (failure) throw failure;
          return {
            receiptId: 'receipt-1',
            submittedAt: new Date(this.time).toISOString(),
            endReason: body.endReason,
            alreadySubmitted: false,
          };
        },
      },
    };
  }

  /** Runs every timer due within `ms`, in time order (each may add more). */
  async advance(ms: number): Promise<void> {
    const until = this.time + ms;
    for (;;) {
      const next = this.timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers = this.timers.filter((t) => t !== next);
      this.time = next.at;
      next.fn();
      await flush();
    }
    this.time = until;
    await flush();
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function view(h: Harness, over: Partial<AttemptView> = {}): AttemptView {
  return {
    attemptId: 'attempt-1',
    examId: 'exam-1',
    title: 'Exam',
    phase: 'in_progress',
    serverNow: new Date(h.time).toISOString(),
    endsAt: new Date(h.endsAt).toISOString(),
    remainingSeconds: Math.ceil((h.endsAt - h.time) / 1000),
    graceSeconds: 30,
    questions: [
      { text: 'One', options: ['a', 'b', 'c', 'd'] },
      { text: 'Two', options: ['a', 'b', 'c', 'd'] },
      { text: 'Three', options: ['a', 'b', 'c', 'd'] },
    ],
    answers: null,
    savedSeq: null,
    violationCount: 0,
    violationWarnings: 5,
    receipt: null,
    ...over,
  };
}

function player(h: Harness, over: Partial<AttemptView> = {}) {
  const c = new ExamController(view(h, over), h.deps(), 30 * 60);
  c.start();
  return c;
}

test('time-up submits the CURRENT answers after the 0-20 s spread, never an empty list', async () => {
  const h = new Harness();
  const c = player(h);
  c.answer(0, 2);
  c.answer(2, 1);
  await h.advance(10 * 60_000);
  assert.equal(c.getState().phase, 'ending');
  c.answer(1, 3); // locked at time-up
  await h.advance(20_000);
  assert.equal(h.submits.length, 1);
  assert.deepEqual(h.submits[0]!.answers, [2, null, 1]);
  assert.equal(h.submits[0]!.endReason, 'time_up');
  assert.equal(c.getState().phase, 'submitted');
  assert.equal(readExam(h.store, 'attempt-1'), null, 'the local copy goes once the receipt is in');
});

test('warnings 1-5 only warn; the 6th violation submits the current answers (owner Q4)', async () => {
  const h = new Harness();
  const c = player(h);
  c.answer(1, 0);
  for (let i = 1; i <= 5; i++) {
    c.violation(i % 2 ? 'leave' : 'devtools');
    assert.equal(c.getState().phase, 'warning');
    assert.equal(c.getState().violationCount, i);
    c.dismissWarning();
    assert.equal(c.getState().phase, 'running');
  }
  assert.equal(h.submits.length, 0);
  c.violation('leave');
  await h.advance(0);
  assert.equal(h.submits.length, 1);
  assert.deepEqual(h.submits[0]!.answers, [null, 0, null]);
  assert.equal(h.submits[0]!.endReason, 'violations');
  assert.equal(h.submits[0]!.violationCount, 6);
  assert.equal(
    h.submits[0]!.events.filter((e) => e.type === 'leave' || e.type === 'devtools').length,
    6,
  );
});

test('a violation counts even while a warning is on screen', () => {
  const h = new Harness();
  const c = player(h);
  c.violation('leave');
  c.violation('leave');
  assert.equal(c.getState().violationCount, 2);
});

test('the count survives a reload (local copy) and never goes below the server count', () => {
  const h = new Harness();
  const first = player(h);
  first.violation('leave');
  first.violation('devtools');
  first.violation('leave');
  first.destroy();
  const reloaded = player(h, { violationCount: 0 });
  assert.equal(reloaded.getState().violationCount, 3);
  const otherDevice = new ExamController(
    view(new Harness(), { violationCount: 4 }),
    new Harness().deps(),
    1800,
  );
  assert.equal(otherDevice.getState().violationCount, 4);
});

test('a reload past the warnings submits at once', async () => {
  const h = new Harness();
  player(h, { violationCount: 6 });
  await h.advance(0);
  assert.equal(h.submits[0]?.endReason, 'violations');
});

test('the newer copy of the answers wins: local after a reload, the server on another device', () => {
  const h = new Harness();
  const a = player(h);
  a.answer(0, 3);
  a.answer(1, 2);
  a.destroy();
  assert.deepEqual(player(h, { answers: [0, 0, 0], savedSeq: 1 }).getState().answers, [3, 2, null]);
  assert.deepEqual(player(h, { answers: [1, 1, 1], savedSeq: 9 }).getState().answers, [1, 1, 1]);
});

test('checkpoints every 60-120 s carry the answers, the count and the events', async () => {
  const h = new Harness();
  const c = player(h);
  c.answer(0, 1);
  await h.advance(90_000);
  assert.equal(h.checkpoints.length, 1);
  assert.deepEqual(h.checkpoints[0]!.answers, [1, null, null]);
  assert.equal(c.getState().connection, 'saved');
  c.violation('leave'); // a violation sends one at once
  await h.advance(0);
  assert.equal(h.checkpoints.at(-1)!.violationCount, 1);
});

test('the submit keeps the local copy and retries with the same request id until a receipt', async () => {
  const h = new Harness();
  h.submitFailures = [
    { kind: 'retry', afterMs: null },
    { kind: 'retry', afterMs: null },
  ];
  const c = player(h);
  c.answer(0, 2);
  c.finish();
  await h.advance(0);
  assert.equal(c.getState().phase, 'ending');
  assert.ok(readExam(h.store, 'attempt-1')?.pending, 'kept while unconfirmed');
  await h.advance(2_000);
  await h.advance(4_000);
  assert.equal(h.submits.length, 3);
  assert.equal(new Set(h.submits.map((s) => s.requestId)).size, 1);
  assert.equal(c.getState().phase, 'submitted');
});

test('an unconfirmed submit is sent again after a reload, with its request id and answers', async () => {
  const h = new Harness();
  h.submitFailures = [{ kind: 'expired' }];
  const c = player(h);
  c.answer(2, 3);
  c.finish();
  await h.advance(0);
  assert.equal(c.getState().closedReason, 'session');
  const again = player(h);
  await h.advance(0);
  assert.equal(h.submits.length, 2);
  assert.equal(h.submits[1]!.requestId, h.submits[0]!.requestId);
  assert.deepEqual(h.submits[1]!.answers, [null, null, 3]);
  assert.equal(again.getState().phase, 'submitted');
});

test('a submit after the grace closes the exam: the server keeps the last checkpoint', async () => {
  const h = new Harness();
  h.submitFailures = [{ kind: 'refused', code: 'time_over' }];
  const c = player(h);
  c.finish();
  await h.advance(0);
  assert.equal(c.getState().phase, 'closed');
  assert.equal(c.getState().closedReason, 'time_over');
});
