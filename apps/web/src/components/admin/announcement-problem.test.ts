import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from '../../lib/api.ts';
import { announcementProblem, isoToLocal, localToIso } from './announcement-problem.ts';

const refused = (status: number, details?: unknown) =>
  new ApiRequestError(status, { statusCode: status, code: 'X', message: 'x', details });

test('each refusal of an announcement write gets its own message', () => {
  assert.equal(announcementProblem(refused(409, ['stale'])), 'stale');
  assert.equal(announcementProblem(refused(409, ['archived'])), 'archived');
  assert.equal(announcementProblem(refused(409, ['not_archived'])), 'notArchived');
  assert.equal(announcementProblem(refused(400, ['publish_in_past'])), 'publishInPast');
  assert.equal(announcementProblem(refused(400, ['nothing_to_update'])), 'nothingToUpdate');
  assert.equal(
    announcementProblem(refused(400, ['title must be longer than or equal to 3 characters'])),
    'invalid',
  );
  assert.equal(announcementProblem(refused(403)), 'failed');
  assert.equal(announcementProblem(new TypeError('Failed to fetch')), 'failed');
});

test('the publish time round-trips between the form and ISO', () => {
  assert.equal(localToIso(''), undefined);
  assert.equal(localToIso('not a time'), undefined);
  const iso = localToIso('2026-11-02T10:30');
  assert.ok(iso);
  assert.equal(isoToLocal(iso), '2026-11-02T10:30');
});
