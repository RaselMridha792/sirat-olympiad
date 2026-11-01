import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../../lib/api.ts';
import { pointsProblem, thresholdsValid } from './points-problem.ts';

const refused = (status: number, details?: unknown) =>
  new ApiRequestError(status, { statusCode: status, code: 'X', message: 'x', details });

test('each refusal of a points change or adjustment gets its own message', () => {
  assert.equal(pointsProblem(refused(409, ['stale'])), 'stale');
  assert.equal(pointsProblem(refused(400, ['bad_thresholds'])), 'badThresholds');
  assert.equal(pointsProblem(refused(409, ['not_ambassador'])), 'notAmbassador');
  assert.equal(pointsProblem(refused(400, ['amount must not be equal to 0'])), 'invalid');
  assert.equal(pointsProblem(refused(404)), 'failed');
  assert.equal(pointsProblem(new TypeError('Failed to fetch')), 'failed');
});

test('ranks start at 0, rise, and have distinct names of 2 to 30 characters', () => {
  const ok = [
    { name: 'Bronze', minPoints: 0 },
    { name: 'Silver', minPoints: 100 },
  ];
  assert.equal(thresholdsValid(ok), true);
  assert.equal(thresholdsValid([]), false);
  assert.equal(thresholdsValid([{ name: 'Bronze', minPoints: 1 }]), false);
  assert.equal(thresholdsValid([...ok, { name: 'Gold', minPoints: 100 }]), false);
  assert.equal(thresholdsValid([...ok, { name: ' silver ', minPoints: 200 }]), false);
  assert.equal(thresholdsValid([...ok, { name: 'G', minPoints: 200 }]), false);
  assert.equal(thresholdsValid([...ok, { name: 'Gold', minPoints: 250.5 }]), false);
});
