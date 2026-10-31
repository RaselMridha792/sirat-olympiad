import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRefresher,
  parseRetryAfter,
  RACE_WAIT_MS,
  retryDelayMs,
  type RefreshDeps,
} from './refresh.ts';

const noSleep = async () => {};
const answer =
  (status: number, retryAfter: number | null = null) =>
  async () => ({ status, retryAfter });

test('204 is ok, 401 is expired', async () => {
  assert.deepEqual(await createRefresher({ post: answer(204), sleep: noSleep })(), {
    outcome: 'ok',
  });
  assert.deepEqual(await createRefresher({ post: answer(401), sleep: noSleep })(), {
    outcome: 'expired',
  });
});

test('409 (another tab just refreshed) waits briefly, then is ok', async () => {
  const slept: number[] = [];
  const refresh = createRefresher({ post: answer(409), sleep: async (ms) => void slept.push(ms) });
  assert.deepEqual(await refresh(), { outcome: 'ok' });
  assert.deepEqual(slept, [RACE_WAIT_MS]);
});

test('429, 5xx and network errors are unavailable, never expired', async () => {
  assert.deepEqual(await createRefresher({ post: answer(429, 7), sleep: noSleep })(), {
    outcome: 'unavailable',
    retryAfterMs: 7000,
  });
  for (const status of [500, 502, 503, 504, 403]) {
    assert.deepEqual(await createRefresher({ post: answer(status), sleep: noSleep })(), {
      outcome: 'unavailable',
      retryAfterMs: null,
    });
  }
  const offline: RefreshDeps['post'] = async () => {
    throw new TypeError('Failed to fetch');
  };
  assert.deepEqual(await createRefresher({ post: offline, sleep: noSleep })(), {
    outcome: 'unavailable',
    retryAfterMs: null,
  });
});

test('without Web Locks (older phones), three 401s at once in one tab share one refresh', async () => {
  let posts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const refresh = createRefresher({
    post: async () => {
      posts += 1;
      await gate;
      return { status: 204, retryAfter: null };
    },
    sleep: noSleep,
  });
  const all = Promise.all([refresh(), refresh(), refresh()]);
  release();
  assert.deepEqual(await all, [{ outcome: 'ok' }, { outcome: 'ok' }, { outcome: 'ok' }]);
  assert.equal(posts, 1);
  await refresh(); // finished: the next 401 gets a fresh refresh
  assert.equal(posts, 2);
});

test('with Web Locks, the refresh runs inside the lock; a lock that cannot be had is unavailable', async () => {
  const order: string[] = [];
  const refresh = createRefresher({
    post: async () => {
      order.push('post');
      return { status: 204, retryAfter: null };
    },
    withLock: async (fn) => {
      order.push('lock');
      const result = await fn();
      order.push('unlock');
      return result;
    },
    sleep: noSleep,
  });
  assert.deepEqual(await refresh(), { outcome: 'ok' });
  assert.deepEqual(order, ['lock', 'post', 'unlock']);

  const stuck = createRefresher({
    post: answer(204),
    withLock: async () => {
      throw new DOMException('The lock request is aborted', 'AbortError');
    },
    sleep: noSleep,
  });
  assert.deepEqual(await stuck(), { outcome: 'unavailable', retryAfterMs: null });
});

test('Retry-After and the retry delay', () => {
  assert.equal(parseRetryAfter('1'), 1);
  assert.equal(parseRetryAfter(' 30 '), 30);
  assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT'), null);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(retryDelayMs(0, 5000), 5000);
  assert.equal(retryDelayMs(0, 0), 1000); // at least a second
  assert.equal(retryDelayMs(0, 600_000), 60_000); // at most a minute
  assert.equal(
    retryDelayMs(0, null, () => 0.5),
    2000,
  );
  assert.equal(
    retryDelayMs(3, null, () => 0.5),
    16_000,
  );
  assert.equal(
    retryDelayMs(10, null, () => 0.5),
    30_000,
  );
});
