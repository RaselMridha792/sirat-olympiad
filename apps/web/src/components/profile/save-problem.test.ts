import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../../lib/api.ts';
import { saveProblem } from './save-problem.ts';

const refused = (status: number, code: string) =>
  new ApiRequestError(status, { statusCode: status, code, message: 'x' });

test("only the owner's phone conflict marks the phone field; anything else is a form error", () => {
  assert.equal(saveProblem(refused(409, 'PHONE_REGISTERED')), 'phoneTaken');
  assert.equal(saveProblem(refused(409, 'CONFLICT')), 'failed');
  assert.equal(saveProblem(refused(400, 'BAD_REQUEST')), 'failed');
  assert.equal(saveProblem(refused(403, 'FORBIDDEN')), 'failed');
  assert.equal(saveProblem(new TypeError('Failed to fetch')), 'failed');
});
