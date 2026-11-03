import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HONORIFIC_TOKEN,
  honorificSegments,
  isArabicScript,
  splitOnHonorific,
} from './honorific.ts';

test('the honorific token splits a message into the text around it', () => {
  assert.equal(HONORIFIC_TOKEN, '{saw}');
  assert.deepEqual(splitOnHonorific('রাসূলুল্লাহ {saw}-এর জীবন'), ['রাসূলুল্লাহ ', '-এর জীবন']);
  assert.deepEqual(splitOnHonorific('{saw} and {saw}'), ['', ' and ', '']);
  assert.deepEqual(splitOnHonorific('no token'), ['no token']);
  // Only the exact token: HTML-looking text stays text.
  assert.deepEqual(splitOnHonorific('<b>{SAW}</b>'), ['<b>{SAW}</b>']);
});

test('the word before the honorific and its glued suffix travel with it, so it never starts a line', () => {
  assert.deepEqual(honorificSegments('রাসূলুল্লাহ {saw}-এর জীবন ও আদর্শ'), [
    { kind: 'honorific', before: 'রাসূলুল্লাহ ', after: '-এর' },
    { kind: 'text', text: ' জীবন ও আদর্শ' },
  ]);
  assert.deepEqual(honorificSegments('the Messenger of Allah {saw}'), [
    { kind: 'text', text: 'the Messenger of ' },
    { kind: 'honorific', before: 'Allah ', after: '' },
  ]);
  assert.deepEqual(honorificSegments('{saw} and {saw}.'), [
    { kind: 'honorific', before: '', after: '' },
    { kind: 'text', text: ' ' },
    { kind: 'honorific', before: 'and ', after: '.' },
  ]);
  assert.deepEqual(honorificSegments('no token'), [{ kind: 'text', text: 'no token' }]);
  // Nothing is lost or added: the segments put back together are the message without its tokens.
  const text = 'হযরত মুহাম্মদ {saw}-এর জীবনাদর্শ, বিশ্বনবী {saw}-এর সিরাত';
  const joined = honorificSegments(text)
    .map((s) => (s.kind === 'text' ? s.text : `${s.before}|${s.after}`))
    .join('');
  assert.equal(joined, text.split(HONORIFIC_TOKEN).join('|'));
});

test('only Arabic script counts as Arabic', () => {
  assert.equal(isArabicScript('ﷺ'), true);
  assert.equal(isArabicScript('صلى الله عليه وسلم'), true);
  assert.equal(isArabicScript('(সা.)'), false);
  assert.equal(isArabicScript('(pbuh)'), false);
});
