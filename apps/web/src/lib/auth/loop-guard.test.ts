import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowRefreshVisit, MAX_VISITS, WINDOW_MS } from './loop-guard.ts';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

test(`at most ${MAX_VISITS} visits per page within the window, then /login`, () => {
  const storage = memory();
  assert.equal(allowRefreshVisit(storage, '/dashboard', 1000), true);
  assert.equal(allowRefreshVisit(storage, '/dashboard', 2000), true);
  assert.equal(allowRefreshVisit(storage, '/dashboard', 3000), false);
  // Another page has its own count; the same page is allowed again once the window has passed.
  assert.equal(allowRefreshVisit(storage, '/dashboard/profile', 3000), true);
  assert.equal(allowRefreshVisit(storage, '/dashboard', 1000 + WINDOW_MS), true);
});

test('storage that throws or holds junk: refuse when it throws, start over on junk', () => {
  const broken = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {},
  };
  assert.equal(allowRefreshVisit(broken, '/dashboard', 1), false);
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(allowRefreshVisit(full, '/dashboard', 1), false);
  const junk = memory();
  junk.setItem('sirat-refresh:/dashboard', '{"not":"a list"}');
  assert.equal(allowRefreshVisit(junk, '/dashboard', 1), true);
  junk.setItem('sirat-refresh:/admin', '[9999999999999, "x", null]');
  assert.equal(allowRefreshVisit(junk, '/admin', 1), true); // a future timestamp does not count
});
