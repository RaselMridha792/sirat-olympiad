import type { LayoutV1 } from './layout';
import { correctPosition, scoreAnswers, storedAnswers, type KeyedVersion } from './scoring';

const options = ['A', 'B', 'C', 'D'].map((key) => ({ key, text: key.toLowerCase() }));
const versions = new Map<string, KeyedVersion>([
  ['q1', { options, correctKey: 'C' }],
  ['q2', { options, correctKey: 'A' }],
  ['q3', { options, correctKey: 'D' }],
]);
// q1 shown as C, A, D, B; q2 in order; q3 shown as D, C, B, A.
const layout: LayoutV1 = {
  v: 1,
  q: ['q1', 'q2', 'q3'],
  o: [
    [2, 0, 3, 1],
    [0, 1, 2, 3],
    [3, 2, 1, 0],
  ],
};

describe('scoreAnswers (owner Q1: one mark each, no negative marking)', () => {
  it('compares each displayed choice with the version the student saw', () => {
    expect(scoreAnswers(layout, versions, [0, 0, 0])).toBe(3);
    expect(scoreAnswers(layout, versions, [2, 0, 3])).toBe(1);
    expect(scoreAnswers(layout, versions, [null, null, null])).toBe(0);
    expect(scoreAnswers(layout, versions, [1, 1, 1])).toBe(0);
  });

  it('scores against the version in the layout, not a later one', () => {
    const later = new Map(versions);
    later.set('q1', { options, correctKey: 'A' });
    expect(scoreAnswers(layout, versions, [0, null, null])).toBe(1);
    expect(scoreAnswers(layout, later, [0, null, null])).toBe(0);
  });

  it('finds where the correct option was shown', () => {
    expect(correctPosition(layout, 0, versions.get('q1')!)).toBe(0);
    expect(correctPosition(layout, 2, versions.get('q3')!)).toBe(0);
    expect(correctPosition(layout, 1, versions.get('q2')!)).toBe(0);
  });

  it('reads stored answers defensively', () => {
    expect(storedAnswers({ v: 1, a: [2, null, 1] }, 3)).toEqual([2, null, 1]);
    expect(storedAnswers({}, 2)).toEqual([null, null]);
    expect(storedAnswers({ v: 1, a: [1] }, 2)).toEqual([null, null]);
  });
});
