import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVALID_LINK_MESSAGE,
  linkProblem,
  linkTokenFrom,
  loginProblem,
  readLinkToken,
} from './auth-errors.ts';

const answer = (
  status: number,
  message?: string,
  retryAfter: number | null = null,
  details?: unknown,
) => ({
  status,
  body: message === undefined ? null : { statusCode: status, code: 'X', message, details },
  retryAfter,
});

test('login: 401 wrong, 403 blocked, 400 invalid email, no answer is a network problem', () => {
  assert.deepEqual(loginProblem(answer(401, 'Email or password is incorrect')), { kind: 'wrong' });
  assert.deepEqual(loginProblem(answer(403, 'This account is blocked. Please contact support')), {
    kind: 'blocked',
  });
  assert.deepEqual(loginProblem(answer(400, 'Validation failed')), { kind: 'invalidEmail' });
  assert.deepEqual(loginProblem(null), { kind: 'network' });
  assert.deepEqual(loginProblem(answer(502, 'Service temporarily unavailable')), { kind: 'busy' });
});

test('login: only the API lock is a lock; nginx flood 429 is busy', () => {
  assert.deepEqual(
    loginProblem(
      answer(429, 'Too many attempts. Try again in 15 minutes, or reset your password', 900),
    ),
    { kind: 'locked', minutes: 15 },
  );
  assert.deepEqual(loginProblem(answer(429, 'Too many attempts. Try again in 1 minute', 31)), {
    kind: 'locked',
    minutes: 1,
  });
  assert.deepEqual(loginProblem(answer(429, 'Too many requests, please retry shortly', 1)), {
    kind: 'busy',
  });
  assert.deepEqual(loginProblem(answer(429, undefined, null)), { kind: 'busy' });
  // A long Retry-After without the message still means "wait minutes", not "a moment".
  assert.deepEqual(loginProblem(answer(429, undefined, 120)), { kind: 'locked', minutes: 2 });
});

test('email links: the bad-link message, policy details, 429 and server trouble', () => {
  assert.deepEqual(linkProblem(answer(400, INVALID_LINK_MESSAGE)), { kind: 'badLink' });
  assert.deepEqual(
    linkProblem(
      answer(400, 'Validation failed', null, ['This password is too common. Choose another one']),
    ),
    { kind: 'policy', rule: 'tooCommon' },
  );
  assert.deepEqual(
    linkProblem(answer(400, 'Validation failed', null, ['Password must be at least 8 characters'])),
    { kind: 'policy', rule: 'tooShort' },
  );
  // Any other 400 is not taken for a bad link (the link may still be fine).
  assert.deepEqual(
    linkProblem(answer(400, 'Validation failed', null, ['token must be a string'])),
    {
      kind: 'network',
    },
  );
  assert.deepEqual(linkProblem(answer(429, 'ThrottlerException: Too Many Requests')), {
    kind: 'tooMany',
  });
  assert.deepEqual(linkProblem(answer(503, 'Service temporarily unavailable')), { kind: 'busy' });
  assert.deepEqual(linkProblem(null), { kind: 'network' });
});

test('the link token: only the 43-character base64url shape from the fragment', () => {
  const token = 'A'.repeat(20) + '-_' + 'b9'.repeat(10) + 'z';
  assert.equal(token.length, 43);
  assert.equal(linkTokenFrom(`#token=${token}`), token);
  assert.equal(linkTokenFrom(`token=${token}`), token);
  assert.equal(linkTokenFrom(`#token=${token}&utm=x`), token);
  for (const bad of [
    '',
    '#',
    '#token=',
    `#token=${token}x`,
    `#token=${token.slice(1)}`,
    '#token=' + '+'.repeat(43),
  ]) {
    assert.equal(linkTokenFrom(bad), null, bad);
  }
});

test('a new emailed link opened in the same tab replaces the token; other hashes keep it', () => {
  const first = 'f'.repeat(43);
  const second = 's'.repeat(43);
  assert.deepEqual(readLinkToken(undefined, `#token=${first}`), { token: first, strip: true });
  assert.deepEqual(readLinkToken(undefined, ''), { token: null, strip: false });
  assert.deepEqual(readLinkToken(first, ''), { token: first, strip: false });
  assert.deepEqual(readLinkToken(first, `#token=${second}`), { token: second, strip: true });
  assert.deepEqual(readLinkToken(null, `#token=${second}`), { token: second, strip: true });
  assert.deepEqual(readLinkToken(first, '#token=junk'), { token: null, strip: true });
  assert.deepEqual(readLinkToken(first, '#main'), { token: first, strip: false });
  assert.deepEqual(readLinkToken(undefined, '#main'), { token: null, strip: true });
});
