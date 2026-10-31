import { randomInt } from 'node:crypto';
import {
  answerKeys,
  answersValid,
  drawLayout,
  optionCounts,
  parseLayout,
  renderQuestions,
  shuffled,
  type QuestionVersion,
} from './layout';

const version = (text: string, keepOptionOrder = false): QuestionVersion => ({
  text,
  options: [
    { key: 'A', text: `${text}-a` },
    { key: 'B', text: `${text}-b` },
    { key: 'C', text: `${text}-c` },
    { key: 'D', text: `${text}-d` },
  ],
  keepOptionOrder,
});
const ids = ['q1', 'q2', 'q3', 'q4', 'q5'];
const versions = new Map(ids.map((id) => [id, version(id)]));

describe('drawLayout (owner Q2)', () => {
  it('gives everyone the same questions, only in another order, without a random draw', () => {
    for (let i = 0; i < 50; i++) {
      const layout = drawLayout(ids, 5, false, versions);
      expect([...layout.q].sort()).toEqual(ids);
      expect(layout.o.every((o) => [...o].sort().join() === '0,1,2,3')).toBe(true);
    }
  });

  it('refuses a fixed pool that does not equal the count, and a pool that is too small', () => {
    expect(() => drawLayout(ids, 4, false, versions)).toThrow(/does not fit/);
    expect(() => drawLayout(ids, 6, true, versions)).toThrow(/does not fit/);
  });

  it('draws N distinct questions from a larger pool when the admin chose it', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const layout = drawLayout(ids, 3, true, versions);
      expect(new Set(layout.q).size).toBe(3);
      layout.q.forEach((id) => seen.add(id));
    }
    expect(seen.size).toBe(5);
  });

  it('keeps the option order of a question marked "keep order"', () => {
    const kept = new Map(ids.map((id) => [id, version(id, id === 'q2')]));
    for (let i = 0; i < 20; i++) {
      const layout = drawLayout(ids, 5, false, kept);
      expect(layout.o[layout.q.indexOf('q2')]).toEqual([0, 1, 2, 3]);
    }
  });

  it('uses the CSPRNG by default and varies the order', () => {
    const orders = new Set(
      Array.from({ length: 30 }, () => drawLayout(ids, 5, false, versions).q.join()),
    );
    expect(orders.size).toBeGreaterThan(1);
    expect(shuffled([1, 2, 3], () => 0)).toEqual([2, 3, 1]);
    expect(typeof randomInt).toBe('function');
  });
});

describe('what the student sees and sends', () => {
  const layout = {
    v: 1 as const,
    q: ['q2', 'q1'],
    o: [
      [3, 0, 1, 2],
      [0, 1, 2, 3],
    ],
  };

  it('renders texts in the attempt order, never ids or keys', () => {
    const rendered = renderQuestions(layout, versions);
    expect(rendered).toEqual([
      { text: 'q2', options: ['q2-d', 'q2-a', 'q2-b', 'q2-c'] },
      { text: 'q1', options: ['q1-a', 'q1-b', 'q1-c', 'q1-d'] },
    ]);
    expect(JSON.stringify(rendered)).not.toMatch(/"key"|"q1"\s*:|"id"/);
  });

  it('accepts one position or null per question, nothing else', () => {
    const counts = optionCounts(layout);
    expect(answersValid([0, null], counts)).toBe(true);
    expect(answersValid([3, 3], counts)).toBe(true);
    for (const bad of [[0], [0, null, 1], [4, 0], [-1, 0], [0.5, 0], ['A', 0], {}, null])
      expect(answersValid(bad, counts)).toBe(false);
  });

  it('maps displayed positions back to option keys for scoring', () => {
    expect(answerKeys(layout, versions, [0, null])).toEqual(['D', null]);
    expect(answerKeys(layout, versions, [1, 3])).toEqual(['A', 'D']);
  });

  it('refuses a malformed stored layout', () => {
    for (const bad of [
      null,
      {},
      { v: 2, q: [], o: [] },
      { v: 1, q: ['x'], o: [] },
      { v: 1, q: [1], o: [[0]] },
    ])
      expect(() => parseLayout(bad)).toThrow(/malformed/);
    expect(parseLayout(layout)).toBe(layout);
  });
});
