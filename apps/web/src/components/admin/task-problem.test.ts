import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_REFUSALS } from '@sirat/shared';
import { ApiRequestError } from '../../lib/api.ts';
import { adminTasksMessages } from '../../i18n/messages/admin-tasks.ts';
import { taskProblem } from './task-problem.ts';

const refused = (status: number, details?: unknown) =>
  new ApiRequestError(status, { statusCode: status, code: 'X', message: 'x', details });

test('each refusal of a task write gets its own message', () => {
  assert.equal(taskProblem(refused(409, ['stale'])), 'stale');
  assert.equal(taskProblem(refused(409, ['archived'])), 'archived');
  assert.equal(taskProblem(refused(409, ['not_archived'])), 'notArchived');
  assert.equal(taskProblem(refused(409, ['nothing_to_update'])), 'nothingToUpdate');
  assert.equal(taskProblem(refused(409, ['not_ambassador'])), 'notAmbassador');
  assert.equal(taskProblem(refused(409, ['not_open'])), 'notOpen');
  assert.equal(taskProblem(refused(409, ['not_submitted'])), 'notSubmitted');
  assert.equal(taskProblem(refused(409, ['task_side_mismatch'])), 'taskSideMismatch');
  assert.equal(taskProblem(refused(429)), 'limit');
  assert.equal(
    taskProblem(refused(400, ['title must be longer than or equal to 3 characters'])),
    'invalid',
  );
  assert.equal(taskProblem(refused(404)), 'failed');
  assert.equal(taskProblem(new TypeError('Failed to fetch')), 'failed');
});

test('every task refusal the API sends has its own message in both languages', () => {
  for (const code of TASK_REFUSALS) {
    const problem = taskProblem(refused(409, [code]));
    assert.notEqual(problem, 'failed', code);
    assert.ok(adminTasksMessages.en.errors[problem], `en ${code}`);
    assert.ok(adminTasksMessages.bn.errors[problem], `bn ${code}`);
  }
});
