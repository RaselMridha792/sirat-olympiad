import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown } from './countdown-format.ts';

test('mm:ss under an hour, h:mm:ss from one hour on', () => {
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(59), '00:59');
  assert.equal(formatCountdown(3599), '59:59');
  assert.equal(formatCountdown(3600), '1:00:00');
  assert.equal(formatCountdown(3661), '1:01:01');
  assert.equal(formatCountdown(3 * 86400 + 5), '72:00:05');
});

test('never negative, never a fraction', () => {
  assert.equal(formatCountdown(-5), '00:00');
  assert.equal(formatCountdown(59.9), '00:59');
});
