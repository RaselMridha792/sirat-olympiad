import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeoutSignal } from './timeout.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('the signal aborts after the limit', async () => {
  const signal = timeoutSignal(20);
  assert.equal(signal.aborted, false);
  await wait(60);
  assert.equal(signal.aborted, true);
});

test('without AbortSignal.timeout (older browsers) a timer still aborts it', async () => {
  const original = AbortSignal.timeout;
  // @ts-expect-error simulating a browser that lacks it
  delete AbortSignal.timeout;
  try {
    const signal = timeoutSignal(20);
    assert.equal(signal.aborted, false);
    await wait(60);
    assert.equal(signal.aborted, true);
  } finally {
    AbortSignal.timeout = original;
  }
});
