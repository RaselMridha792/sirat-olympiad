import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RENEWALS, mayRenew, recordRenewal, WINDOW_MS } from './loop-guard.ts';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

test(`at most ${MAX_RENEWALS} renewals per page within the window, then /login`, () => {
  const storage = memory();
  assert.equal(mayRenew(storage, '/dashboard', 1000), true);
  assert.equal(recordRenewal(storage, '/dashboard', 1000), true);
  assert.equal(mayRenew(storage, '/dashboard', 2000), true);
  assert.equal(recordRenewal(storage, '/dashboard', 2000), true);
  // The page sent the user back twice: the next arrival goes to /login without trying.
  assert.equal(mayRenew(storage, '/dashboard', 3000), false);
  assert.equal(recordRenewal(storage, '/dashboard', 3000), false);
  // Another page has its own count; the same page is allowed again once the window has passed.
  assert.equal(mayRenew(storage, '/dashboard/profile', 3000), true);
  assert.equal(mayRenew(storage, '/dashboard', 1000 + WINDOW_MS), true);
});

test('arrivals without a working renewal (reloads during an outage) never use up the budget', () => {
  const storage = memory();
  for (let t = 0; t < 10; t += 1) assert.equal(mayRenew(storage, '/dashboard', 1000 + t), true);
  assert.equal(recordRenewal(storage, '/dashboard', 2000), true);
});

test('no storage, or storage that throws, refuses; junk starts over', () => {
  assert.equal(mayRenew(null, '/dashboard', 1), false);
  assert.equal(recordRenewal(null, '/dashboard', 1), false);
  const broken = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {},
  };
  assert.equal(mayRenew(broken, '/dashboard', 1), false);
  assert.equal(recordRenewal(broken, '/dashboard', 1), false);
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(recordRenewal(full, '/dashboard', 1), false);
  const junk = memory();
  junk.setItem('sirat-refresh:/dashboard', '{"not":"a list"}');
  assert.equal(recordRenewal(junk, '/dashboard', 1), true);
  junk.setItem('sirat-refresh:/admin', '[9999999999999, "x", null]');
  assert.equal(mayRenew(junk, '/admin', 1), true); // a future timestamp does not count
});
