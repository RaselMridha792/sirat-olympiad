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
  assert.match(formatDateTime('en', iso), /^31 Oct 2026\D+02:30$/);
});

test('date-times use the same 24-hour clock in both languages, with no AM/PM', () => {
  const evening = '2026-10-30T16:27:00.000Z'; // 22:27 on 30 Oct in Dhaka
  const midnight = '2026-11-01T18:27:00.000Z'; // 00:27 on 2 Nov in Dhaka
  assert.match(formatDateTime('en', evening), /^30 Oct 2026\D+22:27$/);
  assert.match(formatDateTime('en', midnight), /^2 Nov 2026\D+00:27$/);
  assert.match(formatDateTime('bn', evening), /২২:২৭$/);
  assert.match(formatDateTime('bn', midnight), /০০:২৭$/);
  for (const iso of [evening, midnight]) {
    assert.doesNotMatch(formatDateTime('en', iso), /\b(am|pm)\b/i);
    // Bangla script and digits only: no "AM"/"PM" and no other Latin letters or digits.
    assert.doesNotMatch(formatDateTime('bn', iso), /AM|PM/i);
    assert.doesNotMatch(formatDateTime('bn', iso), /[A-Za-z0-9]/);
  }
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

test('each exam state has its own label in both languages', () => {
  // The badge is often shown alone, so "open" and "in progress" must read differently.
  for (const locale of ['en', 'bn'] as const) {
    const labels = Object.values(common[locale].examState);
    assert.equal(new Set(labels).size, labels.length, `${locale}: two exam states share a label`);
  }
});

test('Bangla common strings use one word for "page"', () => {
  assert.doesNotMatch(JSON.stringify(common.bn), /পেজ/);
});
