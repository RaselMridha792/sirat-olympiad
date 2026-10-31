import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataSourceUnavailableError, unavailableSource } from '../unavailable.ts';
import { createHttpSource } from './index.ts';
import {
  DataRequestError,
  getJson,
  getJsonOrNull,
  isRecord,
  withQuery,
  type ApiGet,
  type ApiResult,
} from './request.ts';

/** An ApiGet that answers from a table and records every path it was asked for. */
function fakeApi(answers: Record<string, ApiResult>): ApiGet & { calls: string[] } {
  const calls: string[] = [];
  const get = (async (path: string) => {
    calls.push(path);
    return answers[path] ?? { status: 404, body: null };
  }) as ApiGet & { calls: string[] };
  get.calls = calls;
  return get;
}

const exam = {
  id: 'e1',
  title: 'Round 1',
  category: 'activist',
  durationMinutes: 30,
  questionsPerAttempt: 20,
  windowStart: '2026-11-20T04:00:00.000Z',
  windowEnd: '2026-11-21T16:00:00.000Z',
  state: 'upcoming',
};

test('withQuery encodes values and leaves out null, undefined and empty ones', () => {
  assert.equal(withQuery('/admin/users', {}), '/admin/users');
  assert.equal(
    withQuery('/admin/users', { page: 2, q: 'a&b c', role: undefined, blocked: null, x: '' }),
    '/admin/users?page=2&q=a%26b+c',
  );
  assert.equal(withQuery('/x', { flag: false }), '/x?flag=false');
});

test('getJson returns a 200 body that passes the check', async () => {
  const get = fakeApi({ '/thing': { status: 200, body: { a: 1 } } });
  assert.deepEqual(await getJson(get, '/thing', isRecord), { a: 1 });
});

test('getJson refuses any other status, and the error names no path or value', async () => {
  for (const status of [400, 403, 404, 429, 500, 503]) {
    const get = fakeApi({ '/admin/users?q=someone%40example.com': { status, body: { a: 1 } } });
    await assert.rejects(getJson(get, '/admin/users?q=someone%40example.com', isRecord), (e) => {
      assert.ok(e instanceof DataRequestError);
      assert.equal(e.status, status);
      assert.equal(/users|someone|example/.test(e.message), false, e.message);
      return true;
    });
  }
});

test('getJson refuses a 200 with an unexpected shape', async () => {
  const get = fakeApi({ '/thing': { status: 200, body: ['not', 'a', 'record'] } });
  await assert.rejects(getJson(get, '/thing', isRecord), DataRequestError);
});

test('getJsonOrNull turns 404 into null and still refuses other failures', async () => {
  const get = fakeApi({
    '/gone': { status: 404, body: null },
    '/boom': { status: 500, body: null },
  });
  assert.equal(await getJsonOrNull(get, '/gone', isRecord), null);
  await assert.rejects(getJsonOrNull(get, '/boom', isRecord), DataRequestError);
});

test('the HTTP source implements every DataSource method, unconnected ones fall back to unavailable', async () => {
  const source = createHttpSource(fakeApi({}));
  assert.equal(source.kind, 'http');
  for (const group of ['student', 'leaderboard', 'admin'] as const) {
    assert.deepEqual(
      Object.keys(source[group]).sort(),
      Object.keys(unavailableSource[group]).sort(),
      group,
    );
  }
  await assert.rejects(source.admin.getStats(), DataSourceUnavailableError);
  await assert.rejects(source.student.getAmbassador(), DataSourceUnavailableError);
});

test('student.listExams reads GET /exams and passes on only the card fields', async () => {
  const get = fakeApi({
    // resultsPublished is part of the API's list item; score is a canary for a field the card must never carry.
    '/exams': { status: 200, body: [{ ...exam, resultsPublished: false, score: 17 }] },
  });
  const cards = await createHttpSource(get).student.listExams();
  assert.deepEqual(get.calls, ['/exams']);
  assert.deepEqual(cards, [{ ...exam, resultsPublished: false }]);
});

test('student.listExams refuses an exam with an unknown state or category', async () => {
  for (const bad of [
    { ...exam, resultsPublished: false, state: 'started' },
    { ...exam, resultsPublished: false, category: 'sdg' },
    { ...exam, resultsPublished: false, durationMinutes: '30' },
    { ...exam, resultsPublished: 'no' },
    exam, // resultsPublished missing
  ]) {
    const get = fakeApi({ '/exams': { status: 200, body: [bad] } });
    await assert.rejects(createHttpSource(get).student.listExams(), DataRequestError);
  }
});

test('student.listExams passes a refusal on as an error (the page shows its error state)', async () => {
  const get = fakeApi({ '/exams': { status: 403, body: { code: 'account_blocked' } } });
  await assert.rejects(createHttpSource(get).student.listExams(), DataRequestError);
});
