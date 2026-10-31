import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginUrl, safeNext } from './next-param.ts';

const ORIGIN = 'https://sirat.example';
/** What URLSearchParams hands over for `?next=<encoded>` (one round of percent-decoding). */
const fromQuery = (encoded: string) => new URLSearchParams(`next=${encoded}`).get('next');

test('a dashboard page (with its query) is kept, the fragment is dropped', () => {
  assert.equal(safeNext('/dashboard', ORIGIN), '/dashboard');
  assert.equal(safeNext('/dashboard/profile?saved=1', ORIGIN), '/dashboard/profile?saved=1');
  assert.equal(safeNext('/admin/users?page=2#top', ORIGIN), '/admin/users?page=2');
  assert.equal(safeNext(fromQuery('%2Fadmin%2Fexams%2Fex-1'), ORIGIN), '/admin/exams/ex-1');
});

test('anything outside the dashboards falls back (null)', () => {
  for (const raw of [
    '/',
    '/login',
    '/refresh?next=/dashboard',
    '/dashboardx',
    '/api/auth/me',
    '/admins',
  ]) {
    assert.equal(safeNext(raw, ORIGIN), null, raw);
  }
  // Dot segments are resolved first: this is /login, not a dashboard page.
  assert.equal(safeNext('/dashboard/../login', ORIGIN), null);
  assert.equal(safeNext(null, ORIGIN), null);
  assert.equal(safeNext('', ORIGIN), null);
  assert.equal(safeNext(`/dashboard/${'a'.repeat(2100)}`, ORIGIN), null);
});

test('open-redirect attack strings never leave the origin', () => {
  const attacks = [
    '//evil.example',
    '//evil.example/dashboard',
    '/\\evil.example',
    '/\\/evil.example/dashboard',
    '\\\\evil.example',
    'https://evil.example/dashboard',
    'http:evil.example',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '/.//evil.example',
    '/dashboard\\..\\..\\evil.example',
    '/dashboard@evil.example',
    ' /dashboard',
  ];
  const encoded = [
    '%2F%2Fevil.example',
    '%2F%09%2Fevil.example',
    '%2F%0A%2Fevil.example',
    '%2F%0D%2Fevil.example',
    '%5C%5Cevil.example',
    '%2F%5Cevil.example',
    '%2F%2F%2Fevil.example',
    '%09%2Fdashboard',
    '%2Fdashboard%0A',
    '%2Fdashboard%7F',
  ];
  for (const raw of [...attacks, ...encoded.map(fromQuery)]) {
    const result = safeNext(raw, ORIGIN);
    if (result === null) continue;
    // Anything that survives must be a same-origin dashboard path.
    assert.equal(new URL(result, ORIGIN).origin, ORIGIN, String(raw));
    assert.match(result, /^\/(dashboard|admin)(\/|\?|$)/, String(raw));
  }
  // The common shapes are refused outright.
  for (const raw of [
    '//evil.example',
    '/\\evil.example',
    'https://evil.example/dashboard',
    'javascript:alert(1)',
  ]) {
    assert.equal(safeNext(raw, ORIGIN), null, raw);
  }
  for (const raw of encoded.map(fromQuery)) assert.equal(safeNext(raw, ORIGIN), null, String(raw));
});

test('a double-encoded path stays on this site (it is just an unknown page)', () => {
  const result = safeNext(fromQuery('%252F%252Fevil.example'), ORIGIN);
  assert.equal(result, null); // "%2F%2Fevil.example" does not start with "/"
  assert.equal(safeNext('/dashboard/%2F%2Fevil.example', ORIGIN), '/dashboard/%2F%2Fevil.example');
});

test('loginUrl carries next only when given', () => {
  assert.equal(loginUrl(null), '/login');
  assert.equal(
    loginUrl('/dashboard/profile?saved=1'),
    '/login?next=%2Fdashboard%2Fprofile%3Fsaved%3D1',
  );
});
