import { TwoFactorRequirementCliError, parseRequirementArgs } from './admin-2fa-requirement';

const failure = (argv: string[]) => {
  try {
    parseRequirementArgs(argv);
  } catch (e) {
    return e as TwoFactorRequirementCliError;
  }
  throw new Error('expected a refusal');
};

describe('admin-2fa-requirement arguments', () => {
  it('takes --roles and --reason: the roles in a fixed order without duplicates, the reason on one line', () => {
    expect(
      parseRequirementArgs(['--roles', ' manager, admin,manager ', '--reason', ' Go\n live ']),
    ).toEqual({ roles: ['admin', 'manager'], reason: 'Go live' });
    expect(parseRequirementArgs(['--reason', 'Admins only', '--roles', 'admin'])).toEqual({
      roles: ['admin'],
      reason: 'Admins only',
    });
  });

  it('--roles "" switches the requirement off (none)', () => {
    expect(parseRequirementArgs(['--roles', '', '--reason', 'Testing before go-live'])).toEqual({
      roles: [],
      reason: 'Testing before go-live',
    });
    expect(parseRequirementArgs(['--roles', '  ', '--reason', 'Testing']).roles).toEqual([]);
  });

  it.each([
    [[], /Usage/],
    [['--roles', 'admin'], /Usage/],
    [['--reason', 'Go-live'], /Usage/],
    [['--roles', '--reason', 'Go-live'], /--roles needs a value/],
    [['--roles', 'admin', '--reason', 'Go-live', '--force'], /Unknown argument --force/],
    [['--roles', 'admin,jury', '--reason', 'Go-live'], /Unknown role/],
    [['--roles', 'student', '--reason', 'Go-live'], /Unknown role/],
    [['--roles', 'admin,,manager', '--reason', 'Go-live'], /Unknown role/],
    [['--roles', 'Admin', '--reason', 'Go-live'], /Unknown role/],
    [['--roles', 'admin', '--reason', 'no'], /3-200 characters/],
    [['--roles', 'admin', '--reason', 'x'.repeat(201)], /3-200 characters/],
  ])('refuses %j with exit code 2', (argv, message) => {
    const e = failure(argv as string[]);
    expect(e.message).toMatch(message);
    expect(e.exitCode).toBe(2);
  });

  it('never repeats a stray value or an unknown role back', () => {
    const stray = failure(['--roles', 'admin', '--reason', 'Go-live', '123456']);
    expect(stray.message).toMatch(/Unknown argument\. Usage/);
    expect(stray.message).not.toContain('123456');
    const role = failure(['--roles', 'secret-thing', '--reason', 'Go-live']);
    expect(role.message).not.toContain('secret-thing');
  });
});
