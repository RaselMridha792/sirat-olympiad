import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StudentExamDetail } from '@sirat/shared';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

/* GET /exams/:id through the HTTP source (E4): the waiting room passes on only its own fields. */

const ID = '0b9f6c1e-4a7d-4c2b-9e3f-1a2b3c4d5e6f';

function fakeApi(answers: Record<string, ApiResult>): ApiGet & { calls: string[] } {
  const calls: string[] = [];
  const get = (async (path: string) => {
    calls.push(path);
    return answers[path] ?? { status: 404, body: null };
  }) as ApiGet & { calls: string[] };
  get.calls = calls;
  return get;
}

const detail: StudentExamDetail = {
  id: ID,
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
    attemptId: 'a7f3c9d2-1b4e-4c8a-9f6d-2e5b8c1a7d40',
    phase: 'submitted',
    endsAt: '2026-11-20T04:40:00.000Z',
    receipt: {
      receiptId: 'c0ffee00-0000-4000-8000-000000000001',
      submittedAt: '2026-11-20T04:31:00.000Z',
      endReason: 'violations',
    },
  },
};

test('student.getExam reads GET /exams/:id and passes on only the waiting-room fields', async () => {
  // Canaries for what a waiting room must never carry, at every level.
  const body = {
    ...detail,
    score: 17,
    questions: [{ text: 'Q', correctKey: 'A' }],
    attempt: {
      ...detail.attempt,
      answers: [1, 2],
      receipt: { ...detail.attempt!.receipt, score: 17, rank: 1 },
    },
  };
  const get = fakeApi({ [`/exams/${ID}`]: { status: 200, body } });
  assert.deepEqual(await createHttpSource(get).student.getExam(ID), detail);
  assert.deepEqual(get.calls, [`/exams/${ID}`]);
});

test('student.getExam: not found (null) for an unknown or hidden exam and a malformed id', async () => {
  const get = fakeApi({});
  const source = createHttpSource(get).student;
  assert.equal(await source.getExam(ID), null);
  assert.equal(await source.getExam('ex-practice'), null);
  assert.equal(await source.getExam('../admin/exams'), null);
  assert.deepEqual(get.calls, [`/exams/${ID}`], 'a malformed id sends no request');
});

test('student.getExam refuses an unknown phase or end reason and passes refusals on', async () => {
  const before = { ...detail, state: 'open' as const, attempt: null };
  for (const bad of [
    { ...detail, attempt: { ...detail.attempt, phase: 'started' } },
    { ...detail, attempt: { ...detail.attempt, attemptId: 7 } },
    {
      ...detail,
      attempt: { ...detail.attempt, receipt: { ...detail.attempt!.receipt, endReason: 'x' } },
    },
    { ...before, violationWarnings: '5' },
    { ...before, serverNow: undefined },
  ]) {
    const get = fakeApi({ [`/exams/${ID}`]: { status: 200, body: bad } });
    await assert.rejects(createHttpSource(get).student.getExam(ID), DataRequestError);
  }
  const get = fakeApi({ [`/exams/${ID}`]: { status: 200, body: before } });
  assert.deepEqual(await createHttpSource(get).student.getExam(ID), before);
  const blocked = fakeApi({ [`/exams/${ID}`]: { status: 403, body: null } });
  await assert.rejects(createHttpSource(blocked).student.getExam(ID), DataRequestError);
});

const ATTEMPT = 'a7f3c9d2-1b4e-4c8a-9f6d-2e5b8c1a7d40';
const review = {
  attemptId: ATTEMPT,
  examId: ID,
  title: 'Round 1',
  endReason: 'time_up' as const,
  score: 1,
  questionCount: 2,
  rank: 14,
  timeTakenSeconds: 1200,
  questions: [
    { text: 'Q1', options: ['a', 'b'], chosen: 1, correct: 1, explanation: 'Because.' },
    { text: 'Q2', options: ['a', 'b', 'c'], chosen: null, correct: 0, explanation: null },
  ],
};

test('student.getReview reads the own attempt and passes on only the review fields', async () => {
  const body = {
    ...review,
    userId: 'someone',
    questions: review.questions.map((q) => ({ ...q, questionId: 'q-1', optionKeys: ['A', 'B'] })),
  };
  const get = fakeApi({ [`/attempts/${ATTEMPT}/review`]: { status: 200, body } });
  assert.deepEqual(await createHttpSource(get).student.getReview(ATTEMPT), review);
});

test('student.getReview: no review for not found, not theirs, not published or a malformed id', async () => {
  for (const status of [404, 403]) {
    const get = fakeApi({ [`/attempts/${ATTEMPT}/review`]: { status, body: null } });
    assert.equal(await createHttpSource(get).student.getReview(ATTEMPT), null);
  }
  const get = fakeApi({});
  assert.equal(await createHttpSource(get).student.getReview('att-ex-1'), null);
  assert.deepEqual(get.calls, [], 'a malformed id sends no request');
});

test('student.getReview refuses other failures and unexpected shapes', async () => {
  const failing = fakeApi({ [`/attempts/${ATTEMPT}/review`]: { status: 500, body: null } });
  await assert.rejects(createHttpSource(failing).student.getReview(ATTEMPT), DataRequestError);
  for (const bad of [
    { ...review, endReason: 'quit' },
    { ...review, rank: '14' },
    { ...review, questions: [{ ...review.questions[0], correct: null }] },
    { ...review, questions: [{ ...review.questions[0], options: [1, 2] }] },
  ]) {
    const get = fakeApi({ [`/attempts/${ATTEMPT}/review`]: { status: 200, body: bad } });
    await assert.rejects(createHttpSource(get).student.getReview(ATTEMPT), DataRequestError);
  }
});
