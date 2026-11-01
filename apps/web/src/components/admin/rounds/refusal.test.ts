import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JURY_REFUSALS } from '@sirat/shared';
import { ApiRequestError } from '../../../lib/api.ts';
import { juryMessages } from '../../../i18n/messages/jury.ts';
import { studentRoundMessages } from '../../../i18n/messages/student-round.ts';
import { refusalOf } from './refusal.ts';

const refused = (status: number, details?: unknown) =>
  new ApiRequestError(status, { statusCode: status, code: 'X', message: 'x', details });

test('a known code is its own problem; the rest go by status', () => {
  for (const code of JURY_REFUSALS)
    assert.equal(refusalOf(refused(409, [code]), JURY_REFUSALS), code);
  assert.equal(refusalOf(refused(409, ['other_code']), JURY_REFUSALS), 'failed');
  assert.equal(refusalOf(refused(400, ['url must be shorter']), JURY_REFUSALS), 'invalid');
  assert.equal(refusalOf(refused(404), JURY_REFUSALS), 'notFound');
  assert.equal(refusalOf(refused(429), JURY_REFUSALS), 'limit');
  assert.equal(refusalOf(new TypeError('Failed to fetch'), JURY_REFUSALS), 'failed');
});

test('the codes each page can get have a message in both languages', () => {
  for (const [messages, codes] of [
    [juryMessages, ['bad_scores', 'window_open', 'already_promoted']],
    [
      studentRoundMessages,
      ['bad_video_url', 'window_not_open', 'window_closed', 'not_video_round', 'entry_closed'],
    ],
  ] as const)
    for (const code of [...codes, 'notFound', 'limit', 'invalid', 'failed'])
      for (const lang of ['en', 'bn'] as const)
        assert.ok((messages[lang].errors as Record<string, string>)[code], `${lang} ${code}`);
});
