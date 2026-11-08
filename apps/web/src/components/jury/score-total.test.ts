import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreTotal } from './score-total.ts';

test('the total is out of 100 for any number of criteria', () => {
  const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, '7']));
  assert.equal(scoreTotal(ten, 10), 70);
  assert.equal(scoreTotal({ a: '5', b: '5', c: '5', d: '6' }, 4), 52.5);
  assert.equal(scoreTotal({ a: '10', b: '10', c: '10' }, 3), 100);
  assert.equal(scoreTotal({ a: '0' }, 1), 0);
});

test('a missing, out-of-range or fractional value gives no total', () => {
  for (const values of [{ a: '' }, { a: '11' }, { a: '2.5' }, { a: '-1' }, { a: 'x' }])
    assert.equal(scoreTotal(values, 1), null, JSON.stringify(values));
  assert.equal(scoreTotal({ a: '5' }, 2), null);
  assert.equal(scoreTotal({}, 0), null);
});
