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
