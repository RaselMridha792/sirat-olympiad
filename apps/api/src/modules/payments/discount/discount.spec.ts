import {
  GENERATED_DISCOUNT_CODE_PATTERN,
  isAmbassadorCode,
  isDiscountCodeFormat,
  listPrice,
  MIN_PAYABLE_MINOR,
  priceWithDiscount,
} from '@sirat/shared';
import { generateDiscountCode } from './admin-discount-codes.service';
import { usableNow } from './discount-pricing';

/** The one price rule (DECISIONS "Discount codes"): pure, so every edge is checked here. */
describe('priceWithDiscount', () => {
  it('takes an amount off, whole taka', () => {
    expect(priceWithDiscount(40000, 'amount', 5000)).toEqual({
      listAmountMinor: 40000,
      discountMinor: 5000,
      amountMinor: 35000,
    });
  });

  it('rounds a percentage DOWN to whole taka (the student pays under 1 taka more than the exact share)', () => {
    // 33% of 415 taka is 136.95 taka: 136 taka off.
    expect(priceWithDiscount(41500, 'percent', 33)).toEqual({
      listAmountMinor: 41500,
      discountMinor: 13600,
      amountMinor: 27900,
    });
    expect(priceWithDiscount(40000, 'percent', 25).discountMinor).toBe(10000);
  });

  it('never goes below 10 BDT, for either kind', () => {
    expect(priceWithDiscount(40000, 'amount', 39500)).toEqual({
      listAmountMinor: 40000,
      discountMinor: 39000,
      amountMinor: MIN_PAYABLE_MINOR,
    });
    expect(priceWithDiscount(40000, 'percent', 99).amountMinor).toBe(MIN_PAYABLE_MINOR);
    expect(priceWithDiscount(40000, 'amount', 1_000_000).amountMinor).toBe(MIN_PAYABLE_MINOR);
    // A fee already at or under the floor gets no discount at all.
    expect(priceWithDiscount(1000, 'percent', 50)).toEqual(listPrice(1000));
    expect(priceWithDiscount(800, 'amount', 300)).toEqual(listPrice(800));
  });
});

describe('codes', () => {
  it('accepts 4-20 of A-Z 0-9 and "-", never SR- or TM-, never lower case', () => {
    for (const ok of ['EID2026', 'SIRAT-20', 'DC-ABCD1234', 'A1B2', 'X'.repeat(20)])
      expect([ok, isDiscountCodeFormat(ok)]).toEqual([ok, true]);
    for (const bad of [
      'SR-ABC123',
      'TM-ABC123',
      'eid2026',
      'ABC',
      'X'.repeat(21),
      'EID 26',
      'EID_26',
    ])
      expect([bad, isDiscountCodeFormat(bad)]).toEqual([bad, false]);
    expect(isAmbassadorCode('sr-abc123')).toBe(true);
    expect(isAmbassadorCode('DC-ABC12345')).toBe(false);
  });

  it('generates DC- + 8 Crockford characters, a valid code, different each time', () => {
    const made = new Set(Array.from({ length: 200 }, () => generateDiscountCode()));
    expect(made.size).toBe(200);
    for (const c of made) {
      expect(c).toMatch(GENERATED_DISCOUNT_CODE_PATTERN);
      expect(isDiscountCodeFormat(c)).toBe(true);
    }
  });

  it('is usable only while active, inside its window, and real', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const base = { active: true, startsAt: null, endsAt: null, demoBatchId: null };
    expect(usableNow(base, now)).toBe(true);
    expect(usableNow({ ...base, active: false }, now)).toBe(false);
    expect(usableNow({ ...base, demoBatchId: 'b' }, now)).toBe(false);
    expect(usableNow({ ...base, startsAt: new Date('2026-11-20T10:00:01Z') }, now)).toBe(false);
    expect(usableNow({ ...base, startsAt: now }, now)).toBe(true);
    expect(usableNow({ ...base, endsAt: now }, now)).toBe(false);
    expect(usableNow({ ...base, endsAt: new Date('2026-11-20T10:00:01Z') }, now)).toBe(true);
  });
});
