import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatDateTime, formatDuration, formatNumber } from './format.ts';
import { common } from './common.ts';

test('numbers use Bangla digits in bn and Latin digits in en', () => {
  assert.equal(formatNumber('bn', 1234), '১,২৩৪');
  assert.equal(formatNumber('en', 1234), '1,234');
});

test('dates are shown in Asia/Dhaka, not in the device time zone', () => {
  // 20:30 UTC on 30 Oct is 02:30 on 31 Oct in Dhaka (UTC+6).
  const iso = '2026-10-30T20:30:00.000Z';
  assert.match(formatDate('en', iso), /31 Oct 2026/);
  assert.match(formatDate('bn', iso), /৩১/);
  assert.match(formatDateTime('en', iso), /2:30/);
});

test('durations format as m:ss with locale digits', () => {
  assert.equal(formatDuration('en', 125), '2:05');
  assert.equal(formatDuration('bn', 125), '২:০৫');
  assert.equal(formatDuration('en', -5), '0:00');
});

test('common messages have the same keys in en and bn', () => {
  const shape = (value: unknown): unknown =>
    value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
      : typeof value;
  assert.deepEqual(shape(common.bn), shape(common.en));
  assert.equal(common.bn.pagination.summary('১', '৫'), 'পৃষ্ঠা ১ / ৫');
});
