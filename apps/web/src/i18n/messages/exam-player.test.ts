import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examPlayerMessages } from './exam-player.ts';

/** Owner Q4: the rules say only what the system does, and they warn about phones. */
test('the exam rules claim nothing the system does not do', () => {
  for (const [locale, m] of Object.entries(examPlayerMessages)) {
    const rules = [
      m.rules.duration('30'),
      m.rules.questions('20'),
      m.rules.saved,
      m.rules.leave,
      m.rules.end('5', '6'),
      m.rules.recorded,
      m.rules.phone,
      m.rules.timeUp,
    ].join(' ');
    assert.doesNotMatch(
      rules,
      /\bAI\b|artificial|screenshot|camera|webcam|এআই|স্ক্রিনশট|ক্যামেরা/i,
      locale,
    );
    assert.match(rules, /Do Not Disturb/, `${locale}: the phone hint`);
  }
});
