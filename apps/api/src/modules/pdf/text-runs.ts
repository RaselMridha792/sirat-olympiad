export type RunScript = 'bn' | 'lat';

export interface TextRun {
  script: RunScript;
  text: string;
}

/** Bengali letters, signs and digits (U+0980–U+09FF), the dandas (U+0964/5) and the joiners ZWNJ/ZWJ. */
export const isBengaliCodePoint = (cp: number): boolean =>
  (cp >= 0x0980 && cp <= 0x09ff) ||
  cp === 0x0964 ||
  cp === 0x0965 ||
  cp === 0x200c ||
  cp === 0x200d;

/**
 * Splits text into runs by the font that draws them: Bengali code points go to the Bengali font, everything else to
 * the Latin one. Inside Bengali text, a character the Bengali font also has (a comma, a hyphen, a bracket) stays in
 * the Bengali run, so the run is shaped as one piece; a space joins the run it is in. HarfBuzz shapes each run on its
 * own.
 */
export function splitRuns(text: string, bengaliFontHas: (cp: number) => boolean): TextRun[] {
  const runs: TextRun[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    const last = runs.at(-1);
    let script: RunScript;
    if (isBengaliCodePoint(cp)) script = 'bn';
    else if (ch === ' ' && last) script = last.script;
    else if (last?.script === 'bn' && bengaliFontHas(cp)) script = 'bn';
    else script = 'lat';
    if (last && last.script === script) last.text += ch;
    else runs.push({ script, text: ch });
  }
  return runs;
}
