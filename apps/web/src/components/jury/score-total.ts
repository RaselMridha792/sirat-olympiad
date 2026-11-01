import { ROUND_LIMITS } from '@sirat/shared';

/**
 * The total out of 100 as the server computes it (core C6b): the sum times 100 over (10 × the number of criteria),
 * two decimals. null while a value is missing or is not a whole number from 0 to 10. Pure, for node --test.
 */
export function scoreTotal(values: Record<string, string>, count: number): number | null {
  const list = Object.values(values);
  if (count === 0 || list.length !== count) return null;
  let sum = 0;
  for (const raw of list) {
    if (!/^\d{1,2}$/.test(raw.trim())) return null;
    const value = Number(raw);
    if (value > ROUND_LIMITS.criterionMax) return null;
    sum += value;
  }
  return Math.round(((sum * 100) / (ROUND_LIMITS.criterionMax * count)) * 100) / 100;
}
