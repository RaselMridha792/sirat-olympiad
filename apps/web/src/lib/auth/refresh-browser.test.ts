import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshSession } from './refresh-browser.ts';

// The Lead's rule: a slow API must never end the session, so the refresh POST is never cut short. Any time limit
// on it (a signal) would bring the bug back, however long; this pins the request itself.
test('the refresh POST carries no abort signal: a slow answer is always awaited', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await refreshSession(), { outcome: 'ok' });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(seen.length, 1);
  const call = seen[0];
  assert.ok(call);
  const { url, init } = call;
  assert.equal(url, '/api/auth/refresh');
  assert.equal(init.method, 'POST');
  assert.equal(init.signal, undefined, 'the refresh POST must have no abort signal');
  assert.equal(init.keepalive, true, 'it finishes even if the page goes away');
  assert.equal(new Headers(init.headers).get('X-Requested-With'), 'sirat-web');
});
