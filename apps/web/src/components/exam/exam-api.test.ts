import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure, newRequestId } from './exam-api.ts';
import { ApiRequestError, SessionExpiredError } from '../../lib/api.ts';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('request ids are v4 UUIDs, also where crypto.randomUUID is missing (plain http)', () => {
  assert.match(newRequestId(), V4);
  const original = crypto.randomUUID;
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    const ids = new Set(Array.from({ length: 50 }, () => newRequestId()));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, V4);
  } finally {
    Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
  }
});

test('failures: a refusal stops, the rest is tried again, an ended session keeps everything', () => {
  const refusal = new ApiRequestError(409, {
    statusCode: 409,
    message: 'Validation failed',
    details: ['already_submitted'],
  } as never);
  assert.deepEqual(classifyFailure(refusal), { kind: 'refused', code: 'already_submitted' });
  assert.deepEqual(classifyFailure(new ApiRequestError(429, null, 7)), {
    kind: 'retry',
    afterMs: 7000,
  });
  assert.deepEqual(classifyFailure(new ApiRequestError(503, null)), {
    kind: 'retry',
    afterMs: null,
  });
  assert.deepEqual(classifyFailure(new TypeError('fetch failed')), {
    kind: 'retry',
    afterMs: null,
  });
  assert.deepEqual(classifyFailure(new SessionExpiredError()), { kind: 'expired' });
});
