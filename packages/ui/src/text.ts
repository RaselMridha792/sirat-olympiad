/**
 * First user-perceived character of a name, upper-cased where the script has case.
 * Uses grapheme segmentation so Bangla names keep their vowel signs (e.g. "শা", not "শ").
 * Upper-casing ignores the runtime locale (toUpperCase), so the result is the same everywhere.
 * Segmentation still depends on the runtime (Intl.Segmenter support and its Unicode version), so a
 * client component must not call this while rendering a user's name: work it out on the server and
 * pass the string down (AppShell `userInitial`, Avatar `initial`), or hydration can mismatch.
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
  return (first ?? '?').toUpperCase();
}
