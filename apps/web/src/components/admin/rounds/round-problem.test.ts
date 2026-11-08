import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUND_REFUSALS } from '@sirat/shared';
import { ApiRequestError } from '../../../lib/api.ts';
import { adminRoundsMessages } from '../../../i18n/messages/admin-rounds.ts';
import { roundProblem } from './round-problem.ts';

const refused = (status: number, details?: unknown) =>
  new ApiRequestError(status, { statusCode: status, code: 'X', message: 'x', details });

test('each refusal of a round write is its own problem, and every one has a message in both languages', () => {
  for (const code of ROUND_REFUSALS) {
    assert.equal(roundProblem(refused(409, [code])), code);
    assert.ok(adminRoundsMessages.en.errors[code], `en ${code}`);
    assert.ok(adminRoundsMessages.bn.errors[code], `bn ${code}`);
  }
  assert.equal(roundProblem(refused(400, ['bad_window'])), 'bad_window');
  assert.equal(roundProblem(refused(400, ['topN must not be less than 1'])), 'invalid');
  assert.equal(roundProblem(refused(404)), 'notFound');
  assert.equal(roundProblem(refused(429)), 'limit');
  assert.equal(roundProblem(refused(500)), 'failed');
  assert.equal(roundProblem(new TypeError('Failed to fetch')), 'failed');
});
