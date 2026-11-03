/** Where the honorific goes in a message, e.g. 'রাসূলুল্লাহ {saw}-এর জীবন'. Plain text: nothing is parsed as HTML. */
export const HONORIFIC_TOKEN = '{saw}';

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/** True when the honorific is written in Arabic script (ﷺ), false for a plain form such as "(সা.)". */
export function isArabicScript(text: string): boolean {
  return ARABIC.test(text);
}

/** The text around each token: n tokens give n + 1 parts (the parts may be empty). */
export function splitOnHonorific(text: string): string[] {
  return text.split(HONORIFIC_TOKEN);
}

export type HonorificSegment =
  | { kind: 'text'; text: string }
  /** The honorific with the word before it (and its space) and what is glued after it, e.g. "-এর" or ".". */
  | { kind: 'honorific'; before: string; after: string };

/**
 * The message in segments for rendering. The word before each token and the characters glued after it travel with
 * the honorific, so the renderer can keep them on one line: a line never starts with ﷺ or with its "-এর".
 */
export function honorificSegments(text: string): HonorificSegment[] {
  const parts = splitOnHonorific(text);
  const segments: HonorificSegment[] = [];
  let rest = parts[0] ?? '';
  for (const next of parts.slice(1)) {
    const before = /\S*\s?$/.exec(rest)?.[0] ?? '';
    const head = rest.slice(0, rest.length - before.length);
    if (head) segments.push({ kind: 'text', text: head });
    const after = /^\S*/.exec(next)?.[0] ?? '';
    segments.push({ kind: 'honorific', before, after });
    rest = next.slice(after.length);
  }
  if (rest) segments.push({ kind: 'text', text: rest });
  return segments;
}
