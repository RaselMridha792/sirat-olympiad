/**
 * Bangladeshi mobile numbers in ONE stored form, `01XXXXXXXXX` (DECISIONS 2026-10-31 "Duplicate email and phone at
 * registration", owner): a phone number belongs to one student, so `017…`, `+88017…` and `88017…` must be the same
 * value before any uniqueness check. The database refuses any other form (users_phone_check,
 * pending_registrations_phone_check). The server always normalises; the web may use it only for hints.
 */
export const BD_MOBILE_PATTERN = /^01[3-9][0-9]{8}$/;

/** Returns the stored form, or null when the input is not a Bangladeshi mobile number. */
export function normalizeBdMobile(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '');
  const local = compact.startsWith('+880')
    ? `0${compact.slice(4)}`
    : compact.startsWith('880')
      ? `0${compact.slice(3)}`
      : compact;
  return BD_MOBILE_PATTERN.test(local) ? local : null;
}
