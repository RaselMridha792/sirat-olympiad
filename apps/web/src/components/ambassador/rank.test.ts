import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankStanding } from './rank.ts';

const bronze = { name: 'Bronze', minPoints: 0 };
const silver = { name: 'Silver', minPoints: 100 };
const gold = { name: 'Gold', minPoints: 250 };

test('a new ambassador with 0 points is climbing, never "top rank"', () => {
  assert.deepEqual(rankStanding(0, { current: bronze, next: silver }), {
    kind: 'climbing',
    current: 'Bronze',
    next: 'Silver',
    floor: 0,
    target: 100,
    toNext: 100,
    percent: 0,
  });
});

test('progress is measured inside the current tier', () => {
  const s = rankStanding(185, { current: silver, next: gold });
  assert.equal(s.kind, 'climbing');
  if (s.kind !== 'climbing') return;
  assert.equal(s.toNext, 65);
  assert.equal(s.percent, 57); // (185-100)/(250-100)
});

test('only a real highest tier counts as top rank', () => {
  assert.deepEqual(rankStanding(300, { current: gold, next: null }), {
    kind: 'top',
    current: 'Gold',
  });
});

test('no tiers / no data is "unranked", not "top"', () => {
  assert.deepEqual(rankStanding(0, { current: null, next: null }), { kind: 'unranked' });
  assert.deepEqual(rankStanding(500, { current: null, next: null }), { kind: 'unranked' });
});

test('below the lowest tier and inconsistent data stay sane', () => {
  const below = rankStanding(10, { current: null, next: { name: 'Bronze', minPoints: 50 } });
  assert.ok(
    below.kind === 'climbing' &&
      below.current === null &&
      below.toNext === 40 &&
      below.percent === 20,
  );
  const ahead = rankStanding(120, { current: bronze, next: silver });
  assert.ok(ahead.kind === 'climbing' && ahead.toNext === 0 && ahead.percent === 100);
  const negative = rankStanding(-30, { current: bronze, next: silver }); // after a correction entry
  assert.ok(negative.kind === 'climbing' && negative.percent === 0 && negative.toNext === 130);
});
