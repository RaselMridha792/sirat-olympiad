import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, secretOf, stepAt, totpAt } from './totp.mjs';

// RFC 6238 appendix B (SHA-1), the last 6 of its 8 digits. The key is the ASCII "12345678901234567890".
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('the codes match RFC 6238 (SHA-1)', () => {
  for (const [seconds, code] of [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ]) {
    assert.equal(totpAt(RFC_SECRET, stepAt(seconds * 1000)), code, `at ${seconds} s`);
  }
});

test('base32 decodes the RFC key, in any case and with padding', () => {
  assert.equal(base32Decode(RFC_SECRET).toString('ascii'), '12345678901234567890');
  assert.equal(base32Decode('gezdgnbv gy3tqojq').toString('ascii'), '1234567890');
  assert.equal(base32Decode('MZXW6===').toString('ascii'), 'foo');
  assert.throws(() => base32Decode('NOT-BASE32!'), /not base32/);
});

test('the secret comes from an otpauth link', () => {
  assert.equal(
    secretOf('otpauth://totp/Sirat:a%40b.c?secret=jbswy3dpehpk3pxp&issuer=Sirat'),
    'JBSWY3DPEHPK3PXP',
  );
  assert.equal(secretOf('otpauth://totp/Sirat?issuer=Sirat'), null);
  assert.equal(secretOf('otpauth://totp/Sirat?secret=1890'), null);
  assert.equal(secretOf('not a link'), null);
});
