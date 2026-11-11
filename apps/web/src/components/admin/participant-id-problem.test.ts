import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../../lib/api.ts';
import { participantIdProblem } from './participant-id-problem.ts';

const refused = (status: number) =>
  new ApiRequestError(status, { statusCode: status, code: 'X', message: 'x' });

test('each refusal of "issue a new participant ID" gets its own message', () => {
  assert.equal(participantIdProblem(refused(400)), 'reason');
  assert.equal(participantIdProblem(refused(404)), 'notFound');
  assert.equal(participantIdProblem(refused(403)), 'failed');
  assert.equal(participantIdProblem(refused(429)), 'failed');
  assert.equal(participantIdProblem(refused(500)), 'failed');
  assert.equal(participantIdProblem(new TypeError('Failed to fetch')), 'failed');
});
