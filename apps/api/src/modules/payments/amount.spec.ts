import { minorToWholeTaka, parseAmountToMinor } from './amount';

describe('parseAmountToMinor (S21: PayStation sends strings or numbers)', () => {
  it.each([
    ['400', 40000],
    ['400.00', 40000],
    ['400.0', 40000],
    [' 400.00 ', 40000],
    ['400.5', 40050],
    ['400.05', 40005],
    ['10.00', 1000],
    ['0400', 40000],
    [400, 40000],
    [400.0, 40000],
    [400.5, 40050],
    [0.1 + 0.2, 30],
  ])('%p -> %p paisa', (input, expected) => {
    expect(parseAmountToMinor(input)).toBe(expected);
  });

  it.each([
    '400.123',
    '',
    ' ',
    '4,00',
    '1e3',
    '-400',
    '400.',
    '.5',
    '400 BDT',
    '০৪০০', // Bangla digits are not silently accepted
    '9999999999',
  ])('refuses the string %p', (input) => {
    expect(parseAmountToMinor(input)).toBeNull();
  });

  it.each([null, undefined, true, {}, [], 400.123, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %p',
    (input) => {
      expect(parseAmountToMinor(input)).toBeNull();
    },
  );
});

describe('minorToWholeTaka', () => {
  it('turns paisa into whole taka', () => {
    expect(minorToWholeTaka(40000)).toBe(400);
    expect(minorToWholeTaka(1000)).toBe(10);
  });

  it.each([40050, 0, -100, 1.5])('refuses %p (PayStation takes whole taka only)', (minor) => {
    expect(() => minorToWholeTaka(minor)).toThrow(/whole-taka/);
  });
});
