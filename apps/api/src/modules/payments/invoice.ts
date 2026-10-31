import { randomBytes } from 'node:crypto';

/**
 * Invoice numbers (plan 4.2): the account's prefix + yymmdd (Dhaka date) + 10 random Crockford base32 characters
 * (50 bits). 17-19 uppercase letters and digits, within payments_invoice_number_check (^[A-Z0-9]{10,20}$). The
 * prefix tells test and live invoices apart in our database and in PayStation's panel. Never reused: the column is
 * UNIQUE, and a collision (P2002) makes the caller draw a new one (at most 3 times).
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_CHARS = 10;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // Asia/Dhaka is UTC+6 all year

export function dhakaDateStamp(now: Date): string {
  const dhaka = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const yy = String(dhaka.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(dhaka.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dhaka.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

export function newInvoiceNumber(
  prefix: string,
  now: Date = new Date(),
  random: (size: number) => Buffer = randomBytes,
): string {
  if (!/^[A-Z0-9]{1,3}$/.test(prefix)) throw new Error('invoice prefix must be 1-3 of A-Z/0-9');
  const bytes = random(RANDOM_CHARS);
  // 256 is a multiple of 32, so `byte & 31` is uniform.
  const tail = Array.from(bytes.subarray(0, RANDOM_CHARS), (b) => CROCKFORD[b & 31]).join('');
  return `${prefix}${dhakaDateStamp(now)}${tail}`;
}
