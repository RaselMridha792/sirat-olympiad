import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeStepProblem,
  isTwoFactorStatus,
  manualKeyFrom,
  needsTwoFactor,
  recoveryCodeFrom,
  stepUpProblem,
  totpFrom,
} from './two-factor.ts';

const answer = (
  status: number,
  code?: string,
  message = 'x',
  retryAfter: number | null = null,
) => ({
  status,
  body: { statusCode: status, code: code ?? 'X', message },
  retryAfter,
});

test('only an admin or manager session that has not proved the code is sent to enrolment', () => {
  assert.equal(needsTwoFactor(undefined), false); // 2FA off, or an older API
  assert.equal(needsTwoFactor({ enabled: false, required: false, verified: false }), false); // student, jury
  assert.equal(needsTwoFactor({ enabled: false, required: true, verified: false }), true); // not enrolled yet
  assert.equal(needsTwoFactor({ enabled: true, required: true, verified: true }), false);
});

test('an authenticator code is 6 digits; spaces and dashes typed in between are dropped', () => {
  assert.equal(totpFrom('123456'), '123456');
  assert.equal(totpFrom(' 123 456 '), '123456');
  assert.equal(totpFrom('123-456'), '123456');
  assert.equal(totpFrom('12345'), null);
  assert.equal(totpFrom('1234567'), null);
  assert.equal(totpFrom('12345a'), null);
  assert.equal(totpFrom(''), null);
});

test('a recovery code is 10 base32 characters in any case, sent as XXXXX-XXXXX', () => {
  assert.equal(recoveryCodeFrom('abcde-fgh23'), 'ABCDE-FGH23');
  assert.equal(recoveryCodeFrom('ABCDE FGH23'), 'ABCDE-FGH23');
  assert.equal(recoveryCodeFrom('abcdefgh23'), 'ABCDE-FGH23');
  assert.equal(recoveryCodeFrom('ABCDE-FGH2'), null); // 9
  assert.equal(recoveryCodeFrom('ABCDE-FGH01'), null); // 0 and 1 are not base32
  assert.equal(recoveryCodeFrom('123456'), null);
});

test('the code step: an ended challenge goes back to the password, a wrong code stays', () => {
  assert.deepEqual(codeStepProblem(answer(401, 'TWO_FACTOR_CHALLENGE_INVALID')), {
    kind: 'expired',
  });
  assert.deepEqual(codeStepProblem(answer(401, 'TWO_FACTOR_CODE_INVALID')), { kind: 'wrongCode' });
  assert.deepEqual(codeStepProblem(answer(400, 'BAD_REQUEST')), { kind: 'wrongCode' });
  assert.deepEqual(
    codeStepProblem(answer(429, 'X', 'Too many attempts. Try again in 15 minutes', 900)),
    {
      kind: 'locked',
      minutes: 15,
    },
  );
  assert.deepEqual(codeStepProblem(answer(429, 'X', 'ThrottlerException', 1)), { kind: 'busy' }); // nginx
  assert.deepEqual(codeStepProblem(answer(503)), { kind: 'busy' });
  assert.deepEqual(codeStepProblem(null), { kind: 'network' });
});

test('each refusal of a signed-in 2FA step gets its own text', () => {
  assert.equal(stepUpProblem(answer(400, 'PASSWORD_INCORRECT')), 'wrongPassword');
  assert.equal(stepUpProblem(answer(400, 'TWO_FACTOR_CODE_INVALID')), 'wrongCode');
  assert.equal(stepUpProblem(answer(400, 'BAD_REQUEST')), 'wrongCode');
  assert.equal(stepUpProblem(answer(409, 'TWO_FACTOR_SETUP_REQUIRED')), 'setupAgain');
  assert.equal(stepUpProblem(answer(409, 'TWO_FACTOR_ALREADY_ENABLED')), 'alreadyOn');
  assert.equal(stepUpProblem(answer(409, 'TWO_FACTOR_NOT_ENABLED')), 'notOn');
  assert.equal(stepUpProblem(answer(503, 'TWO_FACTOR_UNAVAILABLE')), 'unavailable');
  assert.equal(stepUpProblem(answer(429)), 'tooMany');
  assert.equal(stepUpProblem(answer(403, 'TWO_FACTOR_REQUIRED')), 'failed');
  assert.equal(stepUpProblem(null), 'failed');
});

test('the manual key comes from the otpauth link, grouped in fours', () => {
  assert.equal(
    manualKeyFrom('otpauth://totp/Sirat:ops%40example.org?secret=JBSWY3DPEHPK3PXP&issuer=Sirat'),
    'JBSW Y3DP EHPK 3PXP',
  );
  assert.equal(
    manualKeyFrom('otpauth://totp/Sirat?secret=jbswy3dpehpk3pxpa==&issuer=Sirat'),
    'JBSW Y3DP EHPK 3PXP A',
  );
  assert.equal(manualKeyFrom('https://example.org/?secret=JBSWY3DPEHPK3PXP'), null);
  assert.equal(manualKeyFrom('otpauth://totp/Sirat?secret=not+base32!'), null);
  assert.equal(manualKeyFrom('otpauth://totp/Sirat'), null);
  assert.equal(manualKeyFrom('not a url'), null);
});

test('the status answer is checked before the page uses it', () => {
  const ok = {
    enabled: true,
    pending: false,
    required: true,
    verified: true,
    recoveryCodesRemaining: 8,
  };
  assert.equal(isTwoFactorStatus(ok), true);
  assert.equal(isTwoFactorStatus({ ...ok, recoveryCodesRemaining: '8' }), false);
  assert.equal(isTwoFactorStatus({ enabled: true }), false);
  assert.equal(isTwoFactorStatus(null), false);
});
