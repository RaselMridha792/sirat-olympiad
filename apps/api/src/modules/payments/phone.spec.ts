import { normalizeBdMobile } from '@sirat/shared';

// Owner rule (DECISIONS 2026-10-31): one phone number, one student. Every accepted form must collapse to the one
// stored form, or the UNIQUE index on users.phone would let the same number in twice.
describe('normalizeBdMobile', () => {
  it.each([
    '01712345678',
    '+8801712345678',
    '8801712345678',
    '017-1234-5678',
    ' 017 1234 5678 ',
    '+880 1712-345678',
  ])('stores %p as 01712345678', (input) => {
    expect(normalizeBdMobile(input)).toBe('01712345678');
  });

  it.each([
    '01312345678',
    '01412345678',
    '01512345678',
    '01612345678',
    '01812345678',
    '01912345678',
  ])('accepts operator prefix %p', (input) => {
    expect(normalizeBdMobile(input)).toBe(input);
  });

  it.each([
    '01212345678', // no such operator
    '01112345678',
    '0171234567', // 10 digits
    '017123456789', // 12 digits
    '1712345678', // no leading 0
    '+8811712345678',
    '00801712345678',
    '0171234567a',
    '٠١٧١٢٣٤٥٦٧٨', // Arabic-Indic digits are not accepted silently
    '',
  ])('refuses %p', (input) => {
    expect(normalizeBdMobile(input)).toBeNull();
  });
});
