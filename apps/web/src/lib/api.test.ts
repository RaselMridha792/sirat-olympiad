import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiRequestError, SessionExpiredError } from './api.ts';

// No navigator.locks in Node: the refresh is single-flight within this "tab", as on older phone browsers.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers by path; records every call as "METHOD /path". */
function serve(answers: Record<string, number>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    return new Response(null, { status: answers[path] ?? 404 });
  }) as typeof fetch;
  return calls;
}

test('logout still refused after two renewals that answered 409: an ordinary 401, not "logged out"', async () => {
  const calls = serve({ '/api/auth/logout': 401, '/api/auth/refresh': 409 });
  await assert.rejects(api('/auth/logout', { method: 'POST', onExpired: 'throw' }), (error) => {
    assert.ok(error instanceof ApiRequestError, 'an ApiRequestError');
    assert.equal(error.status, 401);
    return true;
  });
  assert.deepEqual(calls, [
    'POST /api/auth/logout',
    'POST /api/auth/refresh',
    'POST /api/auth/logout',
    'POST /api/auth/refresh',
    'POST /api/auth/logout',
  ]);
});

test('a refresh that answers 401 ends the session: SessionExpiredError', async () => {
  const calls = serve({ '/api/auth/logout': 401, '/api/auth/refresh': 401 });
  await assert.rejects(
    api('/auth/logout', { method: 'POST', onExpired: 'throw' }),
    SessionExpiredError,
  );
  assert.deepEqual(calls, ['POST /api/auth/logout', 'POST /api/auth/refresh']);
});

test('a refresh that is unavailable (503) is never "expired"', async () => {
  serve({ '/api/auth/logout': 401, '/api/auth/refresh': 503 });
  await assert.rejects(api('/auth/logout', { method: 'POST', onExpired: 'throw' }), (error) => {
    assert.ok(error instanceof ApiRequestError && !(error instanceof SessionExpiredError));
    assert.equal(error.status, 503);
    return true;
  });
});

test('a renewal that works repeats the request once', async () => {
  let logout = 0;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/api/auth/refresh') return new Response(null, { status: 204 });
    logout += 1;
    return new Response(null, { status: logout === 1 ? 401 : 204 });
  }) as typeof fetch;
  await api('/auth/logout', { method: 'POST', onExpired: 'throw' });
  assert.deepEqual(calls, [
    'POST /api/auth/logout',
    'POST /api/auth/refresh',
    'POST /api/auth/logout',
  ]);
});
