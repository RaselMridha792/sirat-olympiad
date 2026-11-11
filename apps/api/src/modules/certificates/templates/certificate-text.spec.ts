import { CERT_TEMPLATE_LIMITS, certFilledWorstCase, certTextProblem } from '@sirat/shared';

/** The shared text rule (C1): the API's DTO and core's renderer read the same function and numbers. */
describe('certTextProblem', () => {
  const { titleMax, bodyMax, signatoryTextMax } = CERT_TEMPLATE_LIMITS;

  it('accepts plain text with the three placeholders, in both languages', () => {
    expect(
      certTextProblem('This certifies that {name} took part in {round} on {date}.', bodyMax),
    ).toBeNull();
    expect(certTextProblem('{name} {date} তারিখে {round}-এ অংশ নিয়েছেন।', bodyMax)).toBeNull();
    expect(certTextProblem('Dr. A. Rahman', signatoryTextMax, false)).toBeNull();
  });

  it.each([
    ['   ', 'empty'],
    ['{school}', 'braces'],
    ['{Name}', 'braces'],
    ['{ name }', 'braces'],
    ['{{name}}', 'braces'],
    ['Award {name', 'braces'],
    ['Award name}', 'braces'],
    ['{}', 'braces'],
    ['<b>{name}</b>', 'html'],
    ['a > b', 'html'],
    ['<script>alert(1)</script>', 'html'],
  ])('%j → %s', (text, problem) => {
    expect(certTextProblem(text, bodyMax)).toBe(problem);
  });

  it('a signatory text allows no placeholder at all', () => {
    expect(certTextProblem('{name}', signatoryTextMax, false)).toBe('braces');
    expect(certTextProblem('x'.repeat(signatoryTextMax + 1), signatoryTextMax, false)).toBe(
      'too_long',
    );
  });

  it('counts each placeholder at its layout budget, not its own length', () => {
    const { name, round, date } = CERT_TEMPLATE_LIMITS.placeholderBudget;
    expect(certFilledWorstCase('{name}')).toBe(name);
    expect(certFilledWorstCase('{name} in {round} on {date}')).toBe(name + round + date + 8);
    expect(certFilledWorstCase('{name}{name}')).toBe(2 * name);
    expect(certTextProblem(`${'x'.repeat(bodyMax - name)}{name}`, bodyMax)).toBeNull();
    expect(certTextProblem(`${'x'.repeat(bodyMax - name + 1)}{name}`, bodyMax)).toBe('too_long');
    // A title of two names is already over the title's box.
    expect(certTextProblem('{name} and {name}', titleMax)).toBe('too_long');
  });
});
