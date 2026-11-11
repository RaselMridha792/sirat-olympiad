/**
 * The participant ID (owner decision 10 Nov; DECISIONS "The participant ID"): printed on the admit card, emailed at
 * registration, and, with the email, the student's and ambassador's login. Canonical form: the mode prefix (`ON`
 * online; `OF` reserved for an offline mode) + 10 random digits + 1 Damm check digit, e.g. `ON48210937552`.
 * The database draws it (gen_participant_id(), a strong random source, never sequential) and checks it with the same
 * rule (participant_id_check); these helpers mirror that rule for forms, the login DTO and display.
 */

export const PARTICIPANT_ID_PREFIXES = ['ON', 'OF'] as const;
export type ParticipantIdPrefix = (typeof PARTICIPANT_ID_PREFIXES)[number];

/** Canonical form: prefix, 10 random digits, 1 check digit. */
export const PARTICIPANT_ID_PATTERN = /^(ON|OF)[0-9]{11}$/;
export const PARTICIPANT_ID_LENGTH = 13;

/** Damm's quasigroup of order 10: catches every single-digit error and every adjacent transposition. */
const DAMM: readonly (readonly number[])[] = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

/** Damm's interim digit over a string of decimal digits: the check digit to append, or 0 when it already ends valid. */
export function dammDigit(digits: string): number {
  let interim = 0;
  for (const ch of digits) {
    const d = ch.charCodeAt(0) - 48;
    if (d < 0 || d > 9) throw new Error('dammDigit: digits only');
    interim = DAMM[interim]![d]!;
  }
  return interim;
}

/** What a person typed, made canonical: upper case, no spaces, dashes or dots (e.g. "on 4821-0937 552"). */
export function normalizeParticipantId(input: string): string {
  return input.replace(/[\s.\-]/g, '').toUpperCase();
}

/** True for a canonical participant ID with a valid check digit (a typo is caught without any lookup). */
export function isParticipantId(value: string): boolean {
  return PARTICIPANT_ID_PATTERN.test(value) && dammDigit(value.slice(2)) === 0;
}

/**
 * The participant ID is the login secret together with the email (owner decision 10 Nov), so anything shown where
 * others may see it (the ambassador ID card, a shared image) carries only this: the prefix and the last 2 characters,
 * "ON •••• •••• •52" (one random digit and the Damm check digit, so a card leaves 10^9 candidates: exam's review of
 * core #35, the lead). The full ID appears only on the admit card page, behind its copy button. A value that is not a
 * canonical ID masks to bullets only.
 */
export function maskParticipantId(canonical: string): string {
  const hidden = '••••';
  if (!PARTICIPANT_ID_PATTERN.test(canonical)) return `${hidden} ${hidden}`;
  return `${canonical.slice(0, 2)} ${hidden} ${hidden} •${canonical.slice(11)}`;
}

/** The shape maskParticipantId gives: what a page may accept as a masked ID. */
export const MASKED_PARTICIPANT_ID_PATTERN = /^(ON|OF) •{4} •{4} •[0-9]{2}$/;

/** For display only (the admit card, the dashboard, emails): "ON 4821 0937 552". Copy buttons copy the canonical form. */
export function formatParticipantId(canonical: string): string {
  if (!PARTICIPANT_ID_PATTERN.test(canonical)) return canonical;
  return `${canonical.slice(0, 2)} ${canonical.slice(2, 6)} ${canonical.slice(6, 10)} ${canonical.slice(10)}`;
}
