import { DemoCliUsageError, parseDemoArgs } from './demo';

const refused = (argv: string[]) => {
  try {
    parseDemoArgs(argv);
  } catch (e) {
    return e as DemoCliUsageError;
  }
  throw new Error('expected a refusal');
};

describe('demo CLI arguments', () => {
  it('takes load or clear with a reason, trimmed and with single spaces', () => {
    expect(parseDemoArgs(['load', '--reason', '  client   demo '])).toEqual({
      action: 'load',
      reason: 'client demo',
    });
    expect(parseDemoArgs(['clear', '--reason', 'before launch'])).toEqual({
      action: 'clear',
      reason: 'before launch',
    });
  });

  it('refuses another action, a missing or short or long reason, and any other argument', () => {
    for (const argv of [
      [],
      ['wipe', '--reason', 'abc'],
      ['load'],
      ['load', '--reason'],
      ['load', '--reason', 'ab'],
      ['load', '--reason', 'x'.repeat(201)],
      ['load', '--reason', 'fine reason', '--force'],
    ])
      expect(refused(argv)).toBeInstanceOf(DemoCliUsageError);
  });

  it('never repeats a stray value back (it could be a secret typed in the wrong place)', () => {
    expect(refused(['load', 'S3cret-Value', '--reason', 'abc']).message).not.toContain('S3cret');
  });
});
