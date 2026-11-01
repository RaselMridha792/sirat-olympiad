import { TwoFactorResetCliError, parseResetArgs } from './admin-2fa-reset';

const failure = (argv: string[]) => {
  try {
    parseResetArgs(argv);
  } catch (e) {
    return e as TwoFactorResetCliError;
  }
  throw new Error('expected a refusal');
};

describe('admin-2fa-reset arguments', () => {
  it('takes --email and --reason, trimming and lower-casing the email and keeping the reason on one line', () => {
    expect(
      parseResetArgs(['--email', ' Ops@Sirat.Test ', '--reason', ' Lost  phone\n12 ']),
    ).toEqual({ email: 'ops@sirat.test', reason: 'Lost phone 12' });
  });

  it.each([
    [[], /Usage/],
    [['--email', 'a@b.co'], /Usage/],
    [['--email', '--reason', 'x'], /--email needs a value/],
    [['--email', 'a@b.co', '--reason', 'ok', '--force'], /Unknown argument --force/],
    [['--email', 'not-an-email', '--reason', 'Lost phone'], /valid email/],
    [['--email', 'a@b.co', '--reason', 'no'], /3-200 characters/],
    [['--email', 'a@b.co', '--reason', 'x'.repeat(201)], /3-200 characters/],
  ])('refuses %j with exit code 2', (argv, message) => {
    const e = failure(argv as string[]);
    expect(e.message).toMatch(message);
    expect(e.exitCode).toBe(2);
  });

  it('never repeats a stray value back (it could be an address or a code)', () => {
    const e = failure(['--email', 'a@b.co', '--reason', 'Lost phone', '123456']);
    expect(e.message).toMatch(/Unknown argument\. Usage/);
    expect(e.message).not.toContain('123456');
  });
});
