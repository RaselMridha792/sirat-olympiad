import { newPromoCode, PROMO_ALPHABET } from './promo-code';

describe('newPromoCode', () => {
  it("has the shape payments' registration form accepts, and no misreadable letters", () => {
    for (let i = 0; i < 500; i += 1) {
      const code = newPromoCode();
      expect(code).toMatch(/^SR-[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(code).toMatch(/^[A-Za-z0-9_-]{3,40}$/); // StartRegistrationDto
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('uses all 32 characters and rarely repeats', () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const code = newPromoCode();
      seen.add(code);
      for (const c of code.slice(3)) chars.add(c);
    }
    expect(PROMO_ALPHABET).toHaveLength(32);
    expect(chars.size).toBe(32);
    expect(seen.size).toBeGreaterThan(1990);
  });
});
