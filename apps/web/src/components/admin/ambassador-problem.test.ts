import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../../lib/api.ts';
import { ambassadorProblem } from './ambassador-problem.ts';

const refused = (status: number, details?: unknown) =>
  new ApiRequestError(status, { statusCode: status, code: 'X', message: 'x', details });

test('each refusal of an approve or revoke gets its own message', () => {
  assert.equal(ambassadorProblem(refused(409, ['not_paid_student'])), 'notPaidStudent');
  assert.equal(ambassadorProblem(refused(409, ['blocked'])), 'blocked');
  assert.equal(ambassadorProblem(refused(409, ['wrong_role'])), 'wrongRole');
  assert.equal(ambassadorProblem(refused(409, ['not_ambassador'])), 'notAmbassador');
  assert.equal(
    ambassadorProblem(refused(400, ['reason must be longer than or equal to 3 characters'])),
    'reason',
  );
  assert.equal(ambassadorProblem(refused(404)), 'failed');
  assert.equal(ambassadorProblem(new TypeError('Failed to fetch')), 'failed');
});
