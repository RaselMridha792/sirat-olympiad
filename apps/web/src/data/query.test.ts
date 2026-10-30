import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPageSize,
  hrefWith,
  MAX_PAGE_SIZE,
  parseEnum,
  parseId,
  parsePage,
  parsePageQuery,
  parseSearch,
  totalPages,
} from './query.ts';

test('page numbers from the URL are clamped to sane integers', () => {
  assert.equal(parsePage('3'), 3);
  assert.equal(parsePage(['4', '9']), 4);
  for (const bad of [undefined, '', '0', '-2', '2.5', '1e3', 'abc', '999999999']) {
    assert.equal(parsePage(bad), 1, `page=${String(bad)}`);
  }
});

test('search text is trimmed, collapsed and capped', () => {
  assert.equal(parseSearch('  Padma   Model  '), 'Padma Model');
  assert.equal(parseSearch('   '), undefined);
  assert.equal(parseSearch('x'.repeat(500))?.length, 100);
  assert.equal(parseSearch('নাফিস'), 'নাফিস');
});

test('enum and id params only accept allow-listed shapes', () => {
  assert.equal(parseEnum('admin', ['student', 'admin'] as const), 'admin');
  assert.equal(parseEnum('superuser', ['student', 'admin'] as const), undefined);
  assert.equal(parseId('usr-1a2b-00001'), 'usr-1a2b-00001');
  assert.equal(parseId('../etc/passwd'), undefined);
  assert.equal(parseId('x'.repeat(65)), undefined);
});

test('page size can never exceed the server maximum', () => {
  assert.equal(clampPageSize(5000), MAX_PAGE_SIZE);
  assert.equal(clampPageSize(0), 1);
  assert.deepEqual(parsePageQuery({ page: '2', q: ' a ' }, 4000), {
    page: 2,
    pageSize: MAX_PAGE_SIZE,
    q: 'a',
  });
  assert.equal(totalPages(0, 20), 1);
  assert.equal(totalPages(41, 20), 3);
});

test('hrefWith builds canonical URLs', () => {
  assert.equal(hrefWith('/x', { page: 1, q: '', round: undefined }), '/x');
  assert.equal(hrefWith('/x', { page: 2, q: 'a b', round: 'rd-1' }), '/x?page=2&q=a+b&round=rd-1');
  assert.equal(hrefWith('/x', { blocked: false, role: 'admin' }), '/x?role=admin');
});
