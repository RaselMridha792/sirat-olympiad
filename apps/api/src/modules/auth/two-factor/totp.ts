import { createHmac, randomBytes } from 'node:crypto';

/**
 * TOTP (RFC 6238) on HMAC-SHA1, 6 digits, 30-second steps: what every authenticator app speaks. Pure, no dependency
 * (node:crypto only). The caller keeps the last accepted step per user, so a code is accepted once (replay).
 */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Steps either side of now that are still accepted: a phone clock 30 s off still works. */
export const TOTP_WINDOW = 1;
/** 160 bits, the size RFC 4226 recommends for an HMAC-SHA1 key. */
const SECRET_BYTES = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding: how authenticator apps take a secret. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** The reverse; spaces, dashes and lower case are accepted. Throws on any other character. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

/** The time step of a moment (seconds since the epoch divided by the period). */
export function totpStep(at: Date | number): number {
  const ms = typeof at === 'number' ? at : at.getTime();
  return Math.floor(ms / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code for one step (RFC 4226 HOTP with the step as the counter), as a zero-padded string. */
export function totpCode(secret: Uint8Array, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', secret).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * The step `code` belongs to within the window around `at`, newest first; null when it matches none, or only steps
 * at or before `lastStep` (a code that was already used). Not constant-time across steps, which is fine: the window
 * is public, and each candidate is a full HMAC.
 */
export function matchTotp(
  secret: Uint8Array,
  code: string,
  at: Date | number,
  lastStep: number | null,
): number | null {
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return null;
  const now = totpStep(at);
  for (let step = now + TOTP_WINDOW; step >= now - TOTP_WINDOW; step -= 1) {
    if (lastStep !== null && step <= lastStep) continue;
    if (totpCode(secret, step) === code) return step;
  }
  return null;
}

/** The otpauth:// URI an authenticator app reads (from a QR code or a link). */
export function otpauthUri(secret: Uint8Array, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
