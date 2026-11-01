import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUSY_RETRY_CAP_SECONDS, busyRetryDelayMs, withBusyRetry } from './start-retry.ts';

/* The start's one automatic retry after 503 SERVICE_BUSY (the API's busy database answer). */

const busy = (retryAfter: number | null = 2) => ({
  status: 503,
  body: { code: 'SERVICE_BUSY' },
  retryAfter,
});

test('a busy answer waits Retry-After plus up to 1 s of jitter, capped at 5 s', () => {
  assert.equal(
    busyRetryDelayMs(busy(2), () => 0),
    2_000,
  );
  assert.equal(
    busyRetryDelayMs(busy(2), () => 0.999),
    2_999,
  );
  assert.equal(
    busyRetryDelayMs(busy(null), () => 0),
    2_000,
    'no Retry-After: 2 s',
  );
  assert.equal(
    busyRetryDelayMs(busy(30), () => 0),
    BUSY_RETRY_CAP_SECONDS * 1_000,
  );
});

test('anything that is not 503 SERVICE_BUSY is not retried', () => {
  assert.equal(busyRetryDelayMs({ status: 503, body: { code: 'SERVICE_UNAVAILABLE' } }), null);
  assert.equal(busyRetryDelayMs({ status: 500, body: { code: 'INTERNAL_SERVER_ERROR' } }), null);
  assert.equal(busyRetryDelayMs({ status: 429, body: null, retryAfter: 2 }), null);
  assert.equal(busyRetryDelayMs(new Error('network')), null);
  assert.equal(busyRetryDelayMs(null), null);
});

test('busy, then accepted: the same request is sent twice and its answer returned', async () => {
  const sent: string[] = [];
  const waits: number[] = [];
  const answers = [Promise.reject(busy()), Promise.resolve({ paymentUrl: 'ok' })];
  answers[0]?.catch(() => undefined);
  const result = await withBusyRetry(
    () => {
      sent.push('start');
      return answers[sent.length - 1] as Promise<{ paymentUrl: string }>;
    },
    async (ms) => void waits.push(ms),
    () => 0.5,
  );
  assert.deepEqual(result, { paymentUrl: 'ok' });
  assert.deepEqual(sent, ['start', 'start']);
  assert.deepEqual(waits, [2_500]);
});

test('busy twice: the second refusal is thrown (the page shows its "busy" text); one retry only', async () => {
  let calls = 0;
  const second = { ...busy(), which: 'second' };
  await assert.rejects(
    withBusyRetry(
      () => {
        calls += 1;
        return Promise.reject(calls === 1 ? busy() : second);
      },
      async () => undefined,
    ),
    (err) => err === second,
  );
  assert.equal(calls, 2);
});

test('another refusal is thrown at once, without a wait', async () => {
  let waited = false;
  const refusal = { status: 409, body: { code: 'EMAIL_REGISTERED' } };
  await assert.rejects(
    withBusyRetry(
      () => Promise.reject(refusal),
      async () => {
        waited = true;
      },
    ),
    (err) => err === refusal,
  );
  assert.equal(waited, false);
});

test('the wizard wraps only the start (idempotent by startRequestId), never the retry of a payment', () => {
  const wizard = readFileSync(new URL('./RegisterWizard.tsx', import.meta.url), 'utf8');
  assert.match(wizard, /withBusyRetry\(\(\) =>\s*registrationApi\.start\(/);
  assert.doesNotMatch(
    wizard,
    /withBusyRetry\(\(\) =>\s*registrationApi\.(retry|resume|cancel|recheck)\(/,
  );
});
