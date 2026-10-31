import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../../lib/api.ts';
import { exportProblem } from './export-problem.ts';

const refused = (status: number, details?: unknown) =>
  new ApiRequestError(status, { statusCode: status, code: 'X', message: 'x', details });

test('each refusal of the export gets its own message', () => {
  assert.equal(exportProblem(refused(400, ['too_many_rows'])), 'tooMany');
  assert.equal(
    exportProblem(refused(400, ['reason must be longer than or equal to 3 characters'])),
    'reason',
  );
  assert.equal(exportProblem(refused(429)), 'limit');
  assert.equal(exportProblem(refused(503)), 'failed');
  assert.equal(exportProblem(refused(400)), 'failed');
  assert.equal(exportProblem(new TypeError('Failed to fetch')), 'failed');
});
