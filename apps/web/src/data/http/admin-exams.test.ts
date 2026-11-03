import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AdminAttemptDetail,
  AdminExamCard,
  AdminExamView,
  ExamResultsStatus,
} from '@sirat/shared';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

/* Admin exam reads through the HTTP source (E5a): management view, results status, attempts with violations. */

const EXAM = '0b9f6c1e-4a7d-4c2b-9e3f-1a2b3c4d5e6f';
const ATTEMPT = 'a7f3c9d2-1b4e-4c8a-9f6d-2e5b8c1a7d40';

function fakeApi(answers: Record<string, ApiResult>): ApiGet & { calls: string[] } {
  const calls: string[] = [];
  const get = (async (path: string) => {
    calls.push(path);
    return answers[path] ?? { status: 404, body: null };
  }) as ApiGet & { calls: string[] };
  get.calls = calls;
  return get;
}

const card: AdminExamCard = {
  id: EXAM,
  title: 'Round 1',
  category: 'activist',
  status: 'published',
  durationMinutes: 30,
  questionsPerAttempt: 2,
  windowStart: '2026-11-20T04:00:00.000Z',
  windowEnd: '2026-11-20T16:00:00.000Z',
  questionCount: 2,
  locked: true,
};

const view: AdminExamView = {
  ...card,
  graceSeconds: 30,
  resultsPublishedAt: null,
  round: { id: 'r-1', name: 'Round 1' },
  roundId: 'r-1',
  randomDraw: false,
  contentVersion: 3,
  publishedAt: '2026-11-10T04:00:00.000Z',
  updatedAt: '2026-11-10T04:00:00.123Z',
  questions: [
    {
      id: 'q-1',
      lineageId: 'l-1',
      version: 2,
      position: 0,
      text: 'Q1',
      options: [
        { key: 'A', text: 'a' },
        { key: 'B', text: 'b' },
      ],
      correctKey: 'B',
      explanation: null,
      keepOptionOrder: false,
      isActive: true,
      deactivatedAt: null,
      createdAt: '2026-11-10T04:00:00.000Z',
      updatedAt: '2026-11-10T04:00:00.000Z',
    },
  ],
  keyCorrections: [
    {
      id: 'k-1',
      questionId: 'q-1',
      position: 0,
      fromKey: 'A',
      toKey: 'B',
      reason: 'The printed key was wrong',
      createdAt: '2026-11-21T04:00:00.000Z',
      createdByName: 'Admin',
    },
  ],
};

const results: ExamResultsStatus = {
  examId: EXAM,
  windowClosed: true,
  counts: { in_progress: 0, submitted: 1, expired: 0, scored: 40 },
  snapshotAt: null,
  generation: 0,
  publishedAt: null,
  canBuild: false,
  canPublish: false,
  keyCorrectedAt: '2026-11-21T04:00:00.000Z',
  rescorePending: 0,
  snapshotStale: true,
  lastCorrection: { position: 0, fromKey: 'A', toKey: 'B', attempts: 41, changed: 7 },
};

const attempt: AdminAttemptDetail = {
  attemptId: ATTEMPT,
  userId: 'u-1',
  name: 'Nafis',
  email: 'nafis@example.com',
  status: 'scored',
  endReason: 'violations',
  violationCount: 6,
  startedAt: '2026-11-20T05:00:00.000Z',
  endsAt: '2026-11-20T05:30:00.000Z',
  submittedAt: '2026-11-20T05:12:00.000Z',
  timeTakenSeconds: 720,
  score: 9,
  events: [
    { type: 'leave', at: 60 },
    { type: 'return', at: 75 },
    { type: 'devtools', at: 300 },
  ],
};
const { events: _events, ...row } = attempt;

test('admin.listExams reads GET /admin/exams with its filters and picks the cards', async () => {
  const path = '/admin/exams?page=2&pageSize=20&q=round&status=published';
  const body = { items: [{ ...card, createdBy: 'x' }], page: 2, pageSize: 20, total: 21 };
  const get = fakeApi({ [path]: { status: 200, body } });
  const list = await createHttpSource(get).admin.listExams({
    page: 2,
    pageSize: 20,
    q: 'round',
    status: 'published',
  });
  assert.deepEqual(list, { items: [card], page: 2, pageSize: 20, total: 21 });
});

test('admin.getExam picks the view at every level; null for unknown and malformed ids', async () => {
  const body = {
    ...view,
    createdBy: 'x',
    round: { ...view.round, opensAt: 'x' },
    questions: view.questions.map((q) => ({
      ...q,
      examId: 'x',
      options: q.options.map((o) => ({ ...o, x: 1 })),
    })),
    keyCorrections: view.keyCorrections.map((k) => ({ ...k, createdById: 'u-9' })),
  };
  const get = fakeApi({ [`/admin/exams/${EXAM}`]: { status: 200, body } });
  const source = createHttpSource(get).admin;
  assert.deepEqual(await source.getExam(EXAM), view);
  assert.equal(await source.getExam('0b9f6c1e-4a7d-4c2b-9e3f-000000000000'), null);
  assert.equal(await source.getExam('ex-1'), null);
  assert.equal(get.calls.length, 2, 'a malformed id sends no request');
  for (const bad of [
    { ...view, updatedAt: undefined },
    { ...view, questions: [{ ...view.questions[0], correctKey: null }] },
    { ...view, status: 'live' },
    { ...view, keyCorrections: undefined },
    { ...view, keyCorrections: [{ ...view.keyCorrections[0], toKey: null }] },
  ]) {
    const wrong = fakeApi({ [`/admin/exams/${EXAM}`]: { status: 200, body: bad } });
    await assert.rejects(createHttpSource(wrong).admin.getExam(EXAM), DataRequestError);
  }
});

test('admin.getExamResults picks the status and refuses a missing count', async () => {
  const path = `/admin/exams/${EXAM}/results`;
  const body = { ...results, secret: 1, lastCorrection: { ...results.lastCorrection, id: 'k-1' } };
  const get = fakeApi({ [path]: { status: 200, body } });
  assert.deepEqual(await createHttpSource(get).admin.getExamResults(EXAM), results);
  for (const wrong of [
    { ...results, counts: { ...results.counts, expired: undefined } },
    { ...results, rescorePending: undefined },
    { ...results, lastCorrection: { ...results.lastCorrection, changed: 'x' } },
  ]) {
    const bad = fakeApi({ [path]: { status: 200, body: wrong } });
    await assert.rejects(createHttpSource(bad).admin.getExamResults(EXAM), DataRequestError);
  }
});

test('admin.listAttempts sends the violation filters and picks the rows', async () => {
  const path = `/admin/exams/${EXAM}/attempts?page=1&pageSize=20&endReason=violations&minViolations=3`;
  const body = { items: [{ ...row, phone: '01700000001' }], page: 1, pageSize: 20, total: 1 };
  const get = fakeApi({ [path]: { status: 200, body } });
  const list = await createHttpSource(get).admin.listAttempts(EXAM, {
    page: 1,
    pageSize: 20,
    endReason: 'violations',
    minViolations: 3,
  });
  assert.deepEqual(list, { items: [row], page: 1, pageSize: 20, total: 1 });
  const none = fakeApi({});
  const empty = await createHttpSource(none).admin.listAttempts('ex-1', { page: 1, pageSize: 20 });
  assert.equal(empty.total, 0);
  assert.deepEqual(none.calls, []);
});

test('admin.getAttempt returns the events and refuses an unknown event type', async () => {
  const path = `/admin/exams/${EXAM}/attempts/${ATTEMPT}`;
  const get = fakeApi({ [path]: { status: 200, body: { ...attempt, answers: [1, 2] } } });
  assert.deepEqual(await createHttpSource(get).admin.getAttempt(EXAM, ATTEMPT), attempt);
  const bad = fakeApi({
    [path]: { status: 200, body: { ...attempt, events: [{ type: 'screenshot', at: 1 }] } },
  });
  await assert.rejects(createHttpSource(bad).admin.getAttempt(EXAM, ATTEMPT), DataRequestError);
  assert.equal(await createHttpSource(fakeApi({})).admin.getAttempt(EXAM, 'att-1'), null);
});
