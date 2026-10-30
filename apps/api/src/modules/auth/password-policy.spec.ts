import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  IsAcceptablePassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  commonPasswords,
  passwordProblem,
} from './password-policy';

class NewPasswordDto {
  @IsAcceptablePassword()
  password!: string;
}

describe('password policy (owner: 8-128 characters, not in the 10k most common)', () => {
  it('loads the full common-passwords list, lower-cased', () => {
    const list = commonPasswords();
    expect(list.size).toBeGreaterThanOrEqual(10_000);
    expect(list.has('password')).toBe(true);
    expect([...list].every((p) => p === p.toLowerCase())).toBe(true);
  });

  it.each([
    ['7 characters', 'Xq7#mZ2', 'too_short'],
    ['129 characters', 'aB3$'.repeat(33).slice(0, 129), 'too_long'],
    ['a common password', 'password', 'too_common'],
    ['a common password in other case', 'PassWord', 'too_common'],
    ['a common 8-digit number', '12345678', 'too_common'],
    ['a common word with digit', 'trustno1', 'too_common'],
    ['full-width digits that normalize to a common one', '１２３４５６７８', 'too_common'],
  ])('refuses %s', (_label, password, problem) => {
    expect(passwordProblem(password)).toBe(problem);
  });

  it.each([
    ['exactly 8 characters', 'Xq7#mZ2!'],
    ['exactly 128 characters', 'aB3$'.repeat(32)],
    ['a passphrase with spaces', 'blue river under old moon'],
    ['Bangla letters (counted as characters, not bytes)', 'আমারসোনারবাংলা'],
  ])('accepts %s', (_label, password) => {
    expect(passwordProblem(password)).toBeNull();
  });

  it('counts characters, not UTF-16 units: 4 emoji are 4 characters', () => {
    const fourEmoji = '🔒🔑🎓📚';
    expect(fourEmoji.length).toBe(8); // a naive length check would let this through
    expect(passwordProblem(fourEmoji)).toBe('too_short');
    expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]).toEqual([8, 128]);
  });

  it('gives DTOs a message that names the rule and never echoes the password', () => {
    const errors = validateSync(plainToInstance(NewPasswordDto, { password: 'baseball' }));
    const message = JSON.stringify(errors.map((e) => e.constraints));
    expect(message).toContain('too common');
    expect(message).not.toContain('baseball');
    expect(validateSync(plainToInstance(NewPasswordDto, { password: 'Xq7#mZ2!' }))).toEqual([]);
    expect(
      JSON.stringify(validateSync(plainToInstance(NewPasswordDto, { password: 42 }))),
    ).toContain('must be a string');
  });
});
