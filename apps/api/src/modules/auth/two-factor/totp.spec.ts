import {
  base32Decode,
  base32Encode,
  matchTotp,
  newTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
} from './totp';

/* RFC 6238 Appendix B: the SHA-1 key is the ASCII "12345678901234567890"; 8-digit codes at these times. */
const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('totpCode', () => {
  it.each(RFC_VECTORS)('matches RFC 6238 at T=%i', (seconds, expected) => {
    expect(totpCode(RFC_KEY, totpStep(seconds * 1000), 8)).toBe(expected);
  });

  it('gives 6 digits by default, the last 6 of the RFC value', () => {
    expect(totpCode(RFC_KEY, totpStep(59_000))).toBe('287082');
  });
});

describe('matchTotp', () => {
  const at = 1_111_111_111_000;
  const step = totpStep(at);
  const code = (s: number) => totpCode(RFC_KEY, s);

  it('accepts the current step and one either side, and says which', () => {
    expect(matchTotp(RFC_KEY, code(step), at, null)).toBe(step);
    expect(matchTotp(RFC_KEY, code(step - 1), at, null)).toBe(step - 1);
    expect(matchTotp(RFC_KEY, code(step + 1), at, null)).toBe(step + 1);
  });

  it('refuses two steps away, a wrong code, and anything that is not 6 digits', () => {
    expect(matchTotp(RFC_KEY, code(step - 2), at, null)).toBeNull();
    expect(matchTotp(RFC_KEY, code(step + 2), at, null)).toBeNull();
    const wrong = String((Number(code(step)) + 1) % 1_000_000).padStart(6, '0');
    expect(matchTotp(RFC_KEY, wrong, at, null)).toBeNull();
    for (const bad of ['', '12345', '1234567', 'abcdef', ' 12345'])
      expect(matchTotp(RFC_KEY, bad, at, null)).toBeNull();
  });

  it('refuses a step at or before the last one used (replay), and still takes a later one', () => {
    expect(matchTotp(RFC_KEY, code(step), at, step)).toBeNull();
    expect(matchTotp(RFC_KEY, code(step - 1), at, step)).toBeNull();
    expect(matchTotp(RFC_KEY, code(step + 1), at, step)).toBe(step + 1);
  });
});

describe('base32 and the otpauth URI', () => {
  it('round-trips a secret, ignoring spaces, dashes and case', () => {
    const secret = newTotpSecret();
    expect(secret).toHaveLength(20);
    const text = base32Encode(secret);
    expect(text).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(text)).toEqual(secret);
    expect(base32Decode(text.toLowerCase().replace(/(.{4})/g, '$1 '))).toEqual(secret);
    expect(() => base32Decode('ABC1')).toThrow();
  });

  it('matches the RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
  });

  it('builds the URI authenticator apps read', () => {
    const uri = otpauthUri(Buffer.from('foobar'), 'admin@example.org', 'Sirat Olympiad');
    expect(uri).toBe(
      'otpauth://totp/Sirat%20Olympiad%3Aadmin%40example.org?secret=MZXW6YTBOI&issuer=Sirat+Olympiad&algorithm=SHA1&digits=6&period=30',
    );
  });
});
