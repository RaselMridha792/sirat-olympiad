import {
  canExtendWindow,
  publishProblems,
  questionProblems,
  unpublishProblems,
  windowProblems,
  type PublishInput,
} from './exam-rules';

const OPTIONS = [
  { key: 'A', text: 'Alpha' },
  { key: 'B', text: 'Beta' },
  { key: 'C', text: 'Gamma' },
  { key: 'D', text: 'Delta' },
];
const question = (text: string) => ({ text, options: OPTIONS, correctKey: 'B' });
const now = new Date('2026-11-10T00:00:00Z');

function exam(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    windowStart: new Date('2026-11-20T04:00:00Z'),
    windowEnd: new Date('2026-11-21T18:00:00Z'),
    durationMinutes: 30,
    questionsPerAttempt: 3,
    randomDraw: false,
    questions: [question('One'), question('Two'), question('Three')],
    ...overrides,
  };
}

describe('questionProblems', () => {
  it('accepts unique keys with the correct key among them', () => {
    expect(questionProblems({ options: OPTIONS, correctKey: 'D' })).toEqual([]);
  });

  it('refuses a repeated option key and a correct key that is not an option', () => {
    const options = [...OPTIONS.slice(0, 3), { key: 'A', text: 'Again' }];
    expect(questionProblems({ options, correctKey: 'E' })).toEqual([
      'duplicate_option_key',
      'correct_key_missing',
    ]);
  });
});

describe('windowProblems', () => {
  const start = new Date('2026-11-20T04:00:00Z');
  it('needs at least one whole exam inside the window', () => {
    const exactly = new Date(start.getTime() + 30 * 60_000);
    expect(windowProblems({ windowStart: start, windowEnd: exactly, durationMinutes: 30 })).toEqual(
      [],
    );
    const short = new Date(exactly.getTime() - 1);
    expect(windowProblems({ windowStart: start, windowEnd: short, durationMinutes: 30 })).toEqual([
      'window_too_short',
    ]);
  });
});

describe('publishProblems (owner Q2: the same questions for everyone by default)', () => {
  it('publishes when the pool equals the questions per attempt', () => {
    expect(publishProblems(exam(), now)).toEqual([]);
  });

  it('refuses a larger pool unless the admin chose a random draw', () => {
    const four = [question('One'), question('Two'), question('Three'), question('Four')];
    expect(publishProblems(exam({ questions: four }), now)).toEqual(['question_count']);
    expect(publishProblems(exam({ questions: four, randomDraw: true }), now)).toEqual([]);
  });

  it('refuses too few questions, with or without a random draw', () => {
    const two = [question('One'), question('Two')];
    expect(publishProblems(exam({ questions: two }), now)).toEqual(['question_count']);
    expect(publishProblems(exam({ questions: two, randomDraw: true }), now)).toEqual([
      'question_count',
    ]);
  });

  it('refuses a window that is over or too short', () => {
    expect(
      publishProblems(exam({ windowStart: new Date('2026-11-01T00:00:00Z'), windowEnd: now }), now),
    ).toEqual(['window_over']);
    expect(publishProblems(exam({ windowEnd: new Date('2026-11-20T04:29:59Z') }), now)).toEqual([
      'window_too_short',
    ]);
  });

  it('refuses the same question text twice, ignoring case and spacing', () => {
    const questions = [question('What is  SDG?'), question('what is sdg? '), question('Other')];
    expect(publishProblems(exam({ questions }), now)).toEqual(['duplicate_question_text']);
  });

  it('re-checks stored options (a broken row never publishes)', () => {
    const broken = { text: 'Broken', options: OPTIONS, correctKey: 'Z' };
    expect(
      publishProblems(exam({ questions: [question('One'), question('Two'), broken] }), now),
    ).toEqual(['correct_key_missing']);
  });
});

describe('unpublishProblems', () => {
  const windowStart = new Date('2026-11-10T00:10:00Z');
  it('allows unpublishing until 5 minutes before the start, without attempts', () => {
    expect(unpublishProblems({ windowStart }, 0, new Date('2026-11-10T00:04:59Z'), 5)).toEqual([]);
    expect(unpublishProblems({ windowStart }, 0, new Date('2026-11-10T00:05:00Z'), 5)).toEqual([
      'window_started',
    ]);
    expect(unpublishProblems({ windowStart }, 1, new Date('2026-11-10T00:00:00Z'), 5)).toEqual([
      'has_attempts',
    ]);
  });
});

describe('canExtendWindow', () => {
  const end = new Date('2026-11-10T12:00:00Z');
  it('only grows an open window', () => {
    expect(canExtendWindow(end, new Date('2026-11-10T13:00:00Z'), now)).toBe(true);
    expect(canExtendWindow(end, new Date('2026-11-10T11:00:00Z'), now)).toBe(false);
    expect(canExtendWindow(end, end, now)).toBe(false);
    expect(
      canExtendWindow(end, new Date('2026-11-11T00:00:00Z'), new Date('2026-11-10T12:00:00Z')),
    ).toBe(false);
  });
});
