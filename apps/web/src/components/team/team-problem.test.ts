import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../../lib/api.ts';
import { teamProblem } from './team-problem.ts';

const refused = (status: number, details?: unknown) =>
  new ApiRequestError(status, { statusCode: status, code: 'X', message: 'x', details });

test('each refusal of a team write gets its own message', () => {
  assert.equal(teamProblem(refused(409, ['already_has_team'])), 'alreadyHasTeam');
  assert.equal(teamProblem(refused(409, ['name_taken'])), 'nameTaken');
  assert.equal(teamProblem(refused(409, ['already_in_team'])), 'alreadyInTeam');
  assert.equal(teamProblem(refused(409, ['team_full'])), 'teamFull');
  assert.equal(teamProblem(refused(409, ['team_closed'])), 'teamClosed');
  assert.equal(teamProblem(refused(409, ['owner_cannot_leave'])), 'ownerCannotLeave');
  assert.equal(teamProblem(refused(409, ['not_in_team'])), 'notInTeam');
  assert.equal(teamProblem(refused(409, ['stale'])), 'stale');
  assert.equal(teamProblem(refused(409, ['nothing_to_update'])), 'nothingToUpdate');
  assert.equal(teamProblem(refused(404)), 'notFound');
  assert.equal(teamProblem(refused(429)), 'limit');
  assert.equal(teamProblem(refused(400, ['code must match'])), 'invalid');
  assert.equal(teamProblem(refused(500)), 'failed');
  assert.equal(teamProblem(new TypeError('Failed to fetch')), 'failed');
});
