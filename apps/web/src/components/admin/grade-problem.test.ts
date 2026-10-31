import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../../lib/api.ts';
import { gradeProblem } from './grade-problem.ts';

const refused = (status: number, details?: unknown) =>
  new ApiRequestError(status, { statusCode: status, code: 'X', message: 'x', details });

test('each refusal of the grade correction gets its own message', () => {
  assert.equal(gradeProblem(refused(409, ['has_attempt'])), 'hasAttempt');
  assert.equal(gradeProblem(refused(409, ['not_a_student'])), 'notStudent');
  assert.equal(gradeProblem(refused(400, ['grade_level_unknown'])), 'unknown');
  assert.equal(
    gradeProblem(refused(400, ['reason must be longer than or equal to 3 characters'])),
    'reason',
  );
  assert.equal(gradeProblem(refused(403)), 'failed');
  assert.equal(gradeProblem(refused(404)), 'failed');
  assert.equal(gradeProblem(new TypeError('Failed to fetch')), 'failed');
});
