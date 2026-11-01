import { randomBytes } from 'node:crypto';
import { SecretBox, SecretBoxError, parseSecretBoxKey } from './secret-box';

/* AES-256-GCM at rest for TOTP secrets; the key id travels with the ciphertext for rotation. */

const key = () => randomBytes(32);
const secret = Buffer.from('12345678901234567890');

describe('SecretBox', () => {
  it('seals and opens; a new IV every time, and no plaintext in the output', () => {
    const box = new SecretBox(key());
    const a = box.seal(secret);
    const b = box.seal(secret);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1:[0-9a-f]{8}:[\w-]+:[\w-]+:[\w-]+$/);
    expect(a).not.toContain(secret.toString('base64url'));
    expect(box.open(a)).toEqual(secret);
  });

  it('refuses a tampered ciphertext, tag or key id, and another key', () => {
    const box = new SecretBox(key());
    const sealed = box.seal(secret);
    const [v, id, iv, body, tag] = sealed.split(':') as [string, string, string, string, string];
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    for (const bad of [
      [v, id, iv, flip(body), tag],
      [v, id, iv, body, flip(tag)],
      [v, id, flip(iv), body, tag],
      [v, '00000000', iv, body, tag],
      ['v2', id, iv, body, tag],
    ])
      expect(() => box.open(bad.join(':'))).toThrow(SecretBoxError);
    expect(() => new SecretBox(key()).open(sealed)).toThrow(SecretBoxError);
    expect(() => box.open('not sealed')).toThrow(SecretBoxError);
  });

  it('after a rotation opens old secrets with the previous key, seals with the new one, and says what is stale', () => {
    const oldKey = key();
    const oldSealed = new SecretBox(oldKey).seal(secret);
    const rotated = new SecretBox(key(), oldKey);
    expect(rotated.open(oldSealed)).toEqual(secret);
    expect(rotated.isStale(oldSealed)).toBe(true);
    const fresh = rotated.seal(secret);
    expect(rotated.isStale(fresh)).toBe(false);
    expect(() => new SecretBox(key()).open(oldSealed)).toThrow(SecretBoxError);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow(SecretBoxError);
    expect(() => new SecretBox(key(), randomBytes(31))).toThrow(SecretBoxError);
  });
});

describe('parseSecretBoxKey', () => {
  it('takes 64 hex characters, or base64 / base64url of 32 bytes', () => {
    const raw = key();
    expect(parseSecretBoxKey(raw.toString('hex'))).toEqual(raw);
    expect(parseSecretBoxKey(raw.toString('base64'))).toEqual(raw);
    expect(parseSecretBoxKey(raw.toString('base64url'))).toEqual(raw);
  });

  it('refuses anything else: too short, placeholders, blanks', () => {
    for (const bad of [
      undefined,
      '',
      'change-me',
      'a'.repeat(63),
      randomBytes(16).toString('hex'),
      randomBytes(24).toString('base64'),
    ])
      expect(parseSecretBoxKey(bad)).toBeNull();
  });
});
