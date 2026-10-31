/**
 * PayStation amounts in paisa, without floating-point arithmetic on strings (plan 6.3, S21). PayStation sends
 * "400", "400.00" or a number, depending on the API. Anything else is not an amount: the caller treats null as a
 * mismatch, never as zero.
 */
const DECIMAL = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

export function parseAmountToMinor(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    const minor = Math.round(value * 100);
    // 400.123 is not a whole number of paisa; the tolerance only absorbs binary representation (0.1 + 0.2).
    if (Math.abs(minor - value * 100) > 1e-6 || !Number.isSafeInteger(minor)) return null;
    return minor;
  }
  if (typeof value !== 'string') return null;
  const match = DECIMAL.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Whole taka for PayStation's `payment_amount` (an integer in its API). */
export function minorToWholeTaka(amountMinor: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor % 100 !== 0)
    throw new Error('amount_minor must be a positive whole-taka amount in paisa');
  return amountMinor / 100;
}
