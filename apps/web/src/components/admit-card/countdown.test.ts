import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countdownParts } from './countdown.ts';

test('the countdown splits the time left into days, hours, minutes and seconds', () => {
  const now = Date.UTC(2026, 10, 11, 6, 0, 0);
  const target = now + ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000;
  assert.deepEqual(countdownParts(target, now), {
    done: false,
    days: 2,
    hours: 3,
    minutes: 4,
    seconds: 5,
  });
  // Partial seconds round down: it never shows a second that has not started.
  assert.equal(countdownParts(now + 1500, now).seconds, 1);
});

test('the countdown ends at zero and never goes negative', () => {
  const now = Date.UTC(2026, 10, 11, 6, 0, 0);
  for (const target of [now, now - 1, now - 86_400_000])
    assert.deepEqual(countdownParts(target, now), {
      done: true,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
});
