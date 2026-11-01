// Authenticator codes for the e2e scripts' admins and managers (admin two-factor login, RUNBOOK section 22). RFC 6238
// on HMAC-SHA1, 6 digits, 30-second steps, as apps/api/src/modules/auth/two-factor/totp.ts. No dependencies.
//
// The secrets live in apps/web/.e2e-totp.json (git-ignored, mode 600), written by `pnpm --filter @sirat/web
// e2e:2fa-enrol` for one local-stack account at a time; nothing here prints one. The file also keeps the last step
// each account used: the API accepts a code once, so the next login takes a later step (the API accepts one step
// ahead, so at most one step's wait).
import { createHmac } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_MS = 30_000;
/** Steps ahead of now the API still accepts (TOTP_WINDOW). */
const AHEAD = 1;
const STORE = fileURLToPath(new URL('../../.e2e-totp.json', import.meta.url));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function base32Decode(text) {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  const out = [];
  let value = 0;
  let bits = 0;
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error('totp: the secret is not base32');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const stepAt = (ms) => Math.floor(ms / STEP_MS);

/** The 6-digit code of `step` for a base32 secret. */
export function totpAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** The secret of an otpauth:// link (what POST /auth/2fa/setup returns), or null. */
export function secretOf(otpauthUri) {
  try {
    const secret = new URL(otpauthUri).searchParams.get('secret');
    return secret && /^[A-Z2-7]+=*$/i.test(secret) ? secret.toUpperCase() : null;
  } catch {
    return null;
  }
}

function readStore() {
  if (!existsSync(STORE)) return {};
  return JSON.parse(readFileSync(STORE, 'utf8'));
}

function writeStore(store) {
  writeFileSync(STORE, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  chmodSync(STORE, 0o600); // an existing file keeps its mode on write
}

/** Keeps `email`'s secret (after an enrolment); `null` forgets it (after turning two-factor login off). */
export function saveSecret(email, secret) {
  const store = readStore();
  if (secret)
    store[email.toLowerCase()] = { secret, lastStep: store[email.toLowerCase()]?.lastStep ?? 0 };
  else delete store[email.toLowerCase()];
  writeStore(store);
}

export function hasSecret(email) {
  return !!readStore()[email.toLowerCase()]?.secret;
}

/**
 * A code `email` has not used yet, recorded as used. Waits (at most one step) when every step the API accepts now was
 * already used. Throws when no secret is kept for the account.
 */
export async function nextCode(email) {
  const key = email.toLowerCase();
  const entry = readStore()[key];
  if (!entry?.secret)
    throw new Error(
      `no authenticator secret for ${email}: run \`pnpm --filter @sirat/web e2e:2fa-enrol\` for this account first`,
    );
  const step = Math.max(stepAt(Date.now()), entry.lastStep + 1);
  const waitMs = (step - AHEAD) * STEP_MS - Date.now();
  if (waitMs > 0) await sleep(waitMs + 250);
  writeStore({ ...readStore(), [key]: { secret: entry.secret, lastStep: step } });
  return totpAt(entry.secret, step);
}
