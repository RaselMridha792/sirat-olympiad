import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StudentExamDetail } from '@sirat/shared';
import { LEAK_CANARY, withLeakCanaries } from '../../data/mock/leak.ts';
import { toRoomExam } from './room-exam.ts';

const detail: StudentExamDetail = {
  id: 'ex-1',
  title: 'Round 1',
  category: null,
  durationMinutes: 30,
  questionsPerAttempt: 20,
  windowStart: '2026-11-20T04:00:00.000Z',
  windowEnd: '2026-11-21T16:00:00.000Z',
  state: 'submitted',
  resultsPublished: false,
  graceSeconds: 30,
  violationWarnings: 5,
  serverNow: '2026-11-20T05:00:00.000Z',
  attempt: {
    attemptId: 'att-1',
    phase: 'submitted',
    endsAt: '2026-11-20T04:40:00.000Z',
    receipt: {
      receiptId: 'r-1',
      submittedAt: '2026-11-20T04:31:00.000Z',
      endReason: 'submitted',
    },
  },
};

test('the exam room gets only the fields it uses, at every level (nothing else is serialized)', () => {
  const room = toRoomExam(withLeakCanaries(detail));
  const text = JSON.stringify(room);
  for (const canary of Object.values(LEAK_CANARY))
    assert.equal(text.includes(String(canary)), false, String(canary));
  assert.deepEqual(room, {
    id: 'ex-1',
    state: 'submitted',
    windowStart: '2026-11-20T04:00:00.000Z',
    serverNow: '2026-11-20T05:00:00.000Z',
    durationMinutes: 30,
    questionsPerAttempt: 20,
    violationWarnings: 5,
    resultsPublished: false,
    attempt: {
      phase: 'submitted',
      receipt: {
        receiptId: 'r-1',
        submittedAt: '2026-11-20T04:31:00.000Z',
        endReason: 'submitted',
      },
    },
  });
  assert.equal(toRoomExam({ ...detail, attempt: null }).attempt, null);
});
