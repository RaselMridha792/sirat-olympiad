import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminDemoStatus } from '@sirat/shared';
import {
  demoCountRows,
  demoProblem,
  demoRemovable,
  demoRunning,
  validDemoReason,
} from './demo-problem.ts';

const answer = (status: number, details?: unknown, code = 'X') => ({
  status,
  body: { statusCode: status, code, message: 'x', details },
});

test('each refusal of a load or a removal gets its own message', () => {
  for (const code of [
    'demo_not_allowed',
    'demo_exists',
    'demo_busy',
    'demo_absent',
    'payments_live',
    'real_payments',
  ] as const)
    assert.equal(demoProblem(answer(409, [code])), code);
  assert.equal(demoProblem(answer(403, undefined, 'TWO_FACTOR_REQUIRED')), 'twoFactor');
  assert.equal(demoProblem(answer(403)), 'denied');
  assert.equal(demoProblem(answer(401)), 'denied');
  assert.equal(demoProblem(answer(503, ['queue_unavailable'])), 'queue');
  assert.equal(demoProblem(answer(503)), 'busy');
  assert.equal(demoProblem(answer(429)), 'busy');
  assert.equal(demoProblem(answer(400, ['reason must be longer'])), 'invalid');
  assert.equal(demoProblem(answer(409, ['something_new'])), 'invalid');
  assert.equal(demoProblem(null), 'network');
});

test('the reason: 3 to 200 characters after trimming, as the API counts them', () => {
  assert.equal(validDemoReason('ab'), false);
  assert.equal(validDemoReason('  ab  '), false);
  assert.equal(validDemoReason('abc'), true);
  assert.equal(validDemoReason('x'.repeat(200)), true);
  assert.equal(validDemoReason('x'.repeat(201)), false);
  assert.equal(validDemoReason('a      b'), true); // inner runs count as one space: 'a b'
});

test('running while a batch loads or clears, never otherwise', () => {
  const base: AdminDemoStatus = { allowed: true, batch: null, progress: null, lastOutcome: null };
  const batch = (status: 'loading' | 'loaded' | 'failed' | 'clearing', stale = false) => ({
    ...base,
    batch: {
      id: 'b',
      status,
      createdAt: '2026-11-09T00:00:00Z',
      createdByName: 'A',
      counts: {},
      stale,
      logins: [],
      unregisteredStudents: 0,
    },
  });
  assert.equal(demoRunning(base), false);
  assert.equal(demoRunning(batch('loading')), true);
  assert.equal(demoRunning(batch('clearing')), true);
  assert.equal(demoRunning(batch('loaded')), false);
  assert.equal(demoRunning(batch('failed')), false);
  // An abandoned job: no polling, and the removal is offered.
  assert.equal(demoRunning(batch('loading', true)), false);
  assert.equal(demoRemovable(batch('loading', true)), true);
  assert.equal(demoRemovable(batch('clearing', true)), true);
  assert.equal(demoRemovable(batch('loading')), false);
  assert.equal(demoRemovable(batch('loaded')), true);
  assert.equal(demoRemovable(batch('failed')), true);
  assert.equal(demoRemovable(base), false);
});

test('counts: the known order first, then what an area added later, by name', () => {
  assert.deepEqual(
    demoCountRows({ payments: 5, students: 300, zeta: 1, jury: 2, alpha: 3 }, [
      'students',
      'jury',
      'payments',
    ]),
    [
      { key: 'students', value: 300 },
      { key: 'jury', value: 2 },
      { key: 'payments', value: 5 },
      { key: 'alpha', value: 3 },
      { key: 'zeta', value: 1 },
    ],
  );
});
