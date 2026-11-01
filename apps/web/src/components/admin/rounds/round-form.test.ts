import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VIDEO_CRITERIA } from '@sirat/shared';
import { criteriaToText, textToCriteria, typedCountMatches } from './round-form.ts';

test('the criteria go to text and back unchanged', () => {
  assert.deepEqual(textToCriteria(criteriaToText(DEFAULT_VIDEO_CRITERIA)), [
    ...DEFAULT_VIDEO_CRITERIA,
  ]);
});

test('spaces are tidied and blank lines skipped', () => {
  assert.deepEqual(textToCriteria('\n  one |  First   point | প্রথম \n\n'), [
    { key: 'one', en: 'First point', bn: 'প্রথম' },
  ]);
});

test('a line without three parts, a bad or repeated key, or no line at all is refused', () => {
  for (const text of [
    'one | First',
    'one | First | প্রথম | extra',
    'One | First | প্রথম',
    '1st | First | প্রথম',
    'one | | প্রথম',
    'one | First | প্রথম\none | Again | আবার',
    '',
    Array.from({ length: 21 }, (_, i) => `k${i} | E | ব`).join('\n'),
  ])
    assert.equal(textToCriteria(text), null, JSON.stringify(text));
});

test('the typed confirmation is exactly the count, in ASCII or Bangla digits', () => {
  assert.equal(typedCountMatches('86', 86), true);
  assert.equal(typedCountMatches(' ৮৬ ', 86), true);
  assert.equal(typedCountMatches('85', 86), false);
  assert.equal(typedCountMatches('86.0', 86), false);
  assert.equal(typedCountMatches('', 0), false);
  assert.equal(typedCountMatches('0x56', 86), false);
});
