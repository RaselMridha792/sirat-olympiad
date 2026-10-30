import { AdminCliError, parseArgs } from './create-admin';

const failure = (argv: string[]) => {
  try {
    parseArgs(argv);
  } catch (e) {
    return e as AdminCliError;
  }
  throw new Error('expected a refusal');
};

describe('create-admin arguments', () => {
  it('takes --email and --name, trimming and lower-casing the email', () => {
    expect(parseArgs(['--email', ' Ops@Sirat.Test ', '--name', ' Ops Admin '])).toEqual({
      email: 'ops@sirat.test',
      name: 'Ops Admin',
      passwordStdin: false,
    });
    expect(parseArgs(['--password-stdin', '--email', 'a@b.co', '--name', 'A'])).toMatchObject({
      passwordStdin: true,
    });
  });

  it.each([[['--password', 'secret']], [['--password=secret']], [['--passwordsecret']]])(
    'refuses a password given as an argument, never repeating it: %j',
    (extra) => {
      const e = failure(['--email', 'a@b.co', '--name', 'A', ...extra]);
      expect(e.message).toMatch(/Never pass the password as an argument/);
      expect(e.message).not.toContain('secret');
      expect(e.exitCode).toBe(2);
    },
  );

  it('never repeats a stray value back (it could be a password typed in the wrong place)', () => {
    const e = failure(['--email', 'a@b.co', '--name', 'A', 'Quiet-harbour-lamp-58']);
    expect(e.message).toMatch(/Unknown argument\. Usage/);
    expect(e.message).not.toContain('Quiet-harbour');
    expect(e.exitCode).toBe(2);
  });

  it.each([
    [[], /Usage/],
    [['--email', 'a@b.co'], /Usage/],
    [['--email', '--name', 'A'], /--email needs a value/],
    [['--role', 'admin'], /Unknown argument/],
  ])('shows the usage for %j (exit code 2)', (argv, message) => {
    const e = failure(argv as string[]);
    expect(e.message).toMatch(message);
    expect(e.exitCode).toBe(2);
  });

  it('refuses an invalid email and an overlong name', () => {
    expect(failure(['--email', 'not-an-email', '--name', 'A']).message).toMatch(/valid email/);
    expect(failure(['--email', 'a@b.co', '--name', 'x'.repeat(101)]).message).toMatch(
      /at most 100/,
    );
  });
});
