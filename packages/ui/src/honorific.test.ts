import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HONORIFIC_TOKEN, isArabicScript, splitOnHonorific } from './honorific.ts';

test('the honorific token splits a message into the text around it', () => {
  assert.equal(HONORIFIC_TOKEN, '{saw}');
  assert.deepEqual(splitOnHonorific('রাসূলুল্লাহ {saw}-এর জীবন'), ['রাসূলুল্লাহ ', '-এর জীবন']);
  assert.deepEqual(splitOnHonorific('{saw} and {saw}'), ['', ' and ', '']);
  assert.deepEqual(splitOnHonorific('no token'), ['no token']);
  // Only the exact token: HTML-looking text stays text.
  assert.deepEqual(splitOnHonorific('<b>{SAW}</b>'), ['<b>{SAW}</b>']);
});

test('only Arabic script counts as Arabic', () => {
  assert.equal(isArabicScript('ﷺ'), true);
  assert.equal(isArabicScript('صلى الله عليه وسلم'), true);
  assert.equal(isArabicScript('(সা.)'), false);
  assert.equal(isArabicScript('(pbuh)'), false);
});
