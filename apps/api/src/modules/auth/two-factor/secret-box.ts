import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption of TOTP secrets at rest (A2: AES-256-GCM, the key from env, its id in the ciphertext for rotation). A
 * database leak alone does not give the secrets. Format: `v1:<keyId>:<iv>:<ciphertext>:<tag>` (base64url parts);
 * the key id is the first 8 hex characters of SHA-256(key), so it names the key without revealing it.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class SecretBoxError extends Error {}

/** A 32-byte key from env text: 64 hex characters, or base64 / base64url of 32 bytes. Null when it is neither. */
export function parseSecretBoxKey(text: string | undefined): Buffer | null {
  const value = (text ?? '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) return null;
  const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return bytes.length === KEY_BYTES ? bytes : null;
}

const keyIdOf = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 8);

export class SecretBox {
  private readonly current: { id: string; key: Buffer };
  private readonly keys: Map<string, Buffer>;

  /** `current` encrypts and decrypts; `previous` (after a rotation) only decrypts what it encrypted. */
  constructor(current: Buffer, previous?: Buffer | null) {
    if (current.length !== KEY_BYTES) throw new SecretBoxError('the key must be 32 bytes');
    this.current = { id: keyIdOf(current), key: current };
    this.keys = new Map([[this.current.id, current]]);
    if (previous) {
      if (previous.length !== KEY_BYTES)
        throw new SecretBoxError('the previous key must be 32 bytes');
      this.keys.set(keyIdOf(previous), previous);
    }
  }

  seal(plain: Uint8Array): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.current.key, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const parts = [iv, body, cipher.getAuthTag()].map((b) => b.toString('base64url'));
    return [VERSION, this.current.id, ...parts].join(':');
  }

  open(sealed: string): Buffer {
    const parts = sealed.split(':');
    if (parts.length !== 5 || parts[0] !== VERSION) throw new SecretBoxError('not a sealed secret');
    const [, keyId, iv, body, tag] = parts as [string, string, string, string, string];
    const key = this.keys.get(keyId);
    if (!key) throw new SecretBoxError('sealed with an unknown key');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
    } catch {
      throw new SecretBoxError('the sealed secret does not open'); // never the cause: it could hold key material
    }
  }

  /** True when `sealed` was made with an older key: re-seal it with the current one. */
  isStale(sealed: string): boolean {
    return sealed.split(':')[1] !== this.current.id;
  }
}
