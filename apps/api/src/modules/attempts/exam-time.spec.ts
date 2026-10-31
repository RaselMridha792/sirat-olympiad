import {
  attemptPhase,
  remainingSeconds,
  studentExamState,
  timeTakenSeconds,
  withinGrace,
} from './exam-time';

const t = (s: string) => new Date(`2026-11-20T10:${s}Z`);

describe('time rules (server clock)', () => {
  const endsAt = t('30:00');

  it('accepts up to ends_at + grace exactly, refuses one millisecond later', () => {
    expect(withinGrace(endsAt, 30, t('30:30'))).toBe(true);
    expect(withinGrace(endsAt, 30, new Date(t('30:30').getTime() + 1))).toBe(false);
    expect(withinGrace(endsAt, 0, endsAt)).toBe(true);
  });

  it('counts remaining seconds up, never below zero', () => {
    expect(remainingSeconds(endsAt, t('29:58.500'))).toBe(2);
    expect(remainingSeconds(endsAt, t('31:00'))).toBe(0);
  });

  it('measures time taken on the server and never past ends_at (the grace adds no time)', () => {
    expect(timeTakenSeconds(t('00:00'), endsAt, t('12:34.900'))).toBe(754);
    expect(timeTakenSeconds(t('00:00'), endsAt, t('30:20'))).toBe(1800);
  });

  it('tells the phase of an attempt', () => {
    expect(attemptPhase({ status: 'in_progress', endsAt }, 30, t('30:30'))).toBe('in_progress');
    expect(attemptPhase({ status: 'in_progress', endsAt }, 30, t('30:31'))).toBe('time_over');
    expect(attemptPhase({ status: 'submitted', endsAt }, 30, t('10:00'))).toBe('submitted');
    expect(attemptPhase({ status: 'scored', endsAt }, 30, t('10:00'))).toBe('submitted');
  });
});

describe('studentExamState (EXAM-PLAN 3.11)', () => {
  const exam = { windowStart: t('00:00'), windowEnd: t('59:00'), graceSeconds: 30 };
  const attempt = { status: 'in_progress' as const, endsAt: t('40:00') };

  it.each([
    ['upcoming', null, t('00:00').getTime() - 1],
    ['open', null, t('00:00').getTime()],
    ['closed', null, t('59:00').getTime()],
    ['in_progress', attempt, t('40:30').getTime()],
    ['submitted', attempt, t('40:31').getTime()],
    ['submitted', { status: 'expired' as const, endsAt: t('40:00') }, t('41:00').getTime()],
  ] as const)('is %s', (state, a, now) => {
    expect(studentExamState(exam, a, new Date(now))).toBe(state);
  });
});
