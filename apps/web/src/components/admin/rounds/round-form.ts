import { CRITERION_KEY_PATTERN, ROUND_LIMITS as L, type RoundCriterion } from '@sirat/shared';

/** The criteria as the editor's text: one per line, `key | English | বাংলা`. */
export function criteriaToText(list: readonly RoundCriterion[]): string {
  return list.map((c) => `${c.key} | ${c.en} | ${c.bn}`).join('\n');
}

/**
 * The editor's text back as criteria, or null when a line is not `key | English | বাংলা`, a key repeats or the
 * count is out of bounds. Blank lines are skipped. The server checks the same again.
 */
export function textToCriteria(text: string): RoundCriterion[] | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < L.criteriaMin || lines.length > L.criteriaMax) return null;
  const list: RoundCriterion[] = [];
  for (const line of lines) {
    const parts = line.split('|').map((p) => p.trim().replace(/\s+/g, ' '));
    if (parts.length !== 3) return null;
    const [key, en, bn] = parts as [string, string, string];
    if (!CRITERION_KEY_PATTERN.test(key)) return null;
    if (!en || !bn || en.length > L.criterionLabelMax || bn.length > L.criterionLabelMax)
      return null;
    list.push({ key, en, bn });
  }
  return new Set(list.map((c) => c.key)).size === list.length ? list : null;
}

/** Bangla digits (০–৯) as ASCII, so an admin may type the count either way. */
const asciiDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));

/** The promotion's typed confirmation: exactly the number that would go through (lead's review, C6a). */
export function typedCountMatches(typed: string, count: number): boolean {
  const digits = asciiDigits(typed.trim());
  return /^\d+$/.test(digits) && Number(digits) === count;
}
