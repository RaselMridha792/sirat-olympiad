import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeNext } from '../../lib/auth/next-param.ts';
import { BOOK_LOGIN_HREF } from './links.ts';

test("the result page's login link lands on the free book, and A2's safeNext accepts it", () => {
  const url = new URL(BOOK_LOGIN_HREF, 'https://olympiad.example');
  assert.equal(url.pathname, '/login');
  assert.equal(safeNext(url.searchParams.get('next'), url.origin), '/dashboard/book');
});
