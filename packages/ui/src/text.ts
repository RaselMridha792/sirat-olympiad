/**
 * First user-perceived character of a name, upper-cased where the script has case.
 * Uses grapheme segmentation so Bangla names keep their vowel signs (e.g. "শা", not "শ").
 */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const first =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
          .segment(trimmed)
          [Symbol.iterator]()
          .next().value?.segment
      : Array.from(trimmed)[0];
  return (first ?? '?').toLocaleUpperCase();
}
