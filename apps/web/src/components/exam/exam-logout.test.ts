import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SubmitBody } from '@sirat/shared';
import { sendPendingSubmits } from './exam-logout.ts';
import { clearAllExams, writeExam, type KeyValueStore } from './exam-storage.ts';

/* Logout on a shared device (lead, 2026-10-31): an unsent final submit is tried first, then every copy goes. */

function memoryStore(): { store: KeyValueStore; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    store: {
      get length() {
        return map.size;
      },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    },
  };
}

function seed(store: KeyValueStore) {
  writeExam(store, 'with-pending', {
    seq: 4,
    answers: [1, null, 2],
    violationCount: 2,
    events: [{ type: 'leave', at: 30 }],
    pending: { requestId: 'req-1', endReason: 'submitted', answers: [1, null, 2] },
  });
  writeExam(store, 'running', {
    seq: 1,
    answers: [0],
    violationCount: 0,
    events: [],
    pending: null,
  });
  store.setItem('sirat.theme', 'dark');
}

test('a pending submit is attempted with its own request id, then every exam copy is cleared', async () => {
  const { store, map } = memoryStore();
  seed(store);
  const sent: Array<{ attemptId: string; body: SubmitBody }> = [];
  await sendPendingSubmits(store, async (attemptId, body) => {
    sent.push({ attemptId, body });
  });
  assert.equal(sent.length, 1, 'only the attempt with a pending submit');
  assert.equal(sent[0]!.attemptId, 'with-pending');
  assert.deepEqual(sent[0]!.body, {
    requestId: 'req-1',
    answers: [1, null, 2],
    endReason: 'submitted',
    violationCount: 2,
    events: [{ type: 'leave', at: 30 }],
  });
  clearAllExams(store); // the logout worked
  assert.deepEqual([...map.keys()], ['sirat.theme'], 'nothing else in localStorage is removed');
});

test('a failed or hanging submit does not hold the logout past the wait, and is cleared all the same', async () => {
  const { store, map } = memoryStore();
  seed(store);
  const started = Date.now();
  await sendPendingSubmits(store, () => new Promise(() => {}), 50);
  assert.ok(Date.now() - started < 1000, 'bounded');
  await sendPendingSubmits(store, async () => {
    throw new Error('offline');
  });
  assert.ok(map.has('sirat.exam.v1.with-pending'), 'kept until the logout has worked');
  clearAllExams(store);
  assert.deepEqual([...map.keys()], ['sirat.theme']);
});

test('no pending submit: no request, no wait', async () => {
  const { store } = memoryStore();
  writeExam(store, 'running', {
    seq: 1,
    answers: [0],
    violationCount: 0,
    events: [],
    pending: null,
  });
  let calls = 0;
  const started = Date.now();
  await sendPendingSubmits(
    store,
    async () => {
      calls += 1;
    },
    5000,
  );
  assert.equal(calls, 0);
  assert.ok(Date.now() - started < 1000);
});
