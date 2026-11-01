import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminBookMessages } from '../../../i18n/messages/admin-book.ts';
import { adminBookProblem, exportPath, preCheckCover } from './admin-book-rules.ts';

test('reads the API codes, the bare 413 and the rest', () => {
  const answer = (status: number, code: string) => ({
    status,
    body: { statusCode: status, code, message: 'ignored' },
  });
  assert.equal(adminBookProblem(answer(409, 'SETTING_CHANGED')), 'SETTING_CHANGED');
  assert.equal(adminBookProblem(answer(400, 'COVER_UNSUPPORTED_TYPE')), 'COVER_UNSUPPORTED_TYPE');
  assert.equal(adminBookProblem({ status: 413, body: null }), 'COVER_TOO_LARGE');
  assert.equal(adminBookProblem(answer(400, 'BAD_REQUEST')), 'invalid');
  assert.equal(adminBookProblem(answer(403, 'FORBIDDEN')), 'denied');
  assert.equal(adminBookProblem(answer(502, 'BAD_GATEWAY')), 'busy');
  assert.equal(adminBookProblem(null), 'network');
  for (const m of [adminBookMessages.en, adminBookMessages.bn])
    for (const text of Object.values(m.errors)) assert.ok(text.length > 5);
});

test('checks a chosen file before sending it', () => {
  assert.equal(preCheckCover({ size: 1000, type: 'image/png' }), null);
  assert.equal(preCheckCover({ size: 1000, type: '' }), null); // the API decides by the bytes
  assert.equal(preCheckCover({ size: 0, type: 'image/png' }), 'COVER_EMPTY');
  assert.equal(preCheckCover({ size: 819_201, type: 'image/png' }), 'COVER_TOO_LARGE');
  assert.equal(preCheckCover({ size: 1000, type: 'image/svg+xml' }), 'COVER_UNSUPPORTED_TYPE');
});

test('the export path carries only the set filters', () => {
  assert.equal(exportPath({}), '/admin/book-orders/export.csv');
  assert.equal(
    exportPath({ status: 'confirmed', district: "Cox's Bazar" }),
    '/admin/book-orders/export.csv?status=confirmed&district=Cox%27s+Bazar',
  );
});
