import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '@sirat/shared';
import { areaFor, canOpen, decideAccess, homeFor, PAGE_ROLES } from './access.ts';

test('students and ambassadors land on /dashboard, staff on /admin', () => {
  assert.equal(homeFor('student'), '/dashboard');
  assert.equal(homeFor('ambassador'), '/dashboard');
  assert.equal(homeFor('admin'), '/admin');
  assert.equal(homeFor('manager'), '/admin');
  assert.equal(homeFor('jury'), '/admin');
});

test('every role belongs to exactly one area and can open its home', () => {
  for (const role of ROLES) {
    assert.ok(['student', 'admin'].includes(areaFor(role)), role);
    assert.deepEqual(decideAccess(homeFor(role), role), { kind: 'ok' }, role);
  }
});

test('the other area sends the user to their own home', () => {
  assert.deepEqual(decideAccess('/admin', 'student'), { kind: 'redirect', to: '/dashboard' });
  assert.deepEqual(decideAccess('/admin/users', 'ambassador'), {
    kind: 'redirect',
    to: '/dashboard',
  });
  assert.deepEqual(decideAccess('/dashboard/profile', 'admin'), { kind: 'redirect', to: '/admin' });
  assert.deepEqual(decideAccess('/dashboard', 'jury'), { kind: 'redirect', to: '/admin' });
});

test('a page the role may not open inside its own area is not found', () => {
  assert.deepEqual(decideAccess('/dashboard/ambassador', 'student'), { kind: 'not-found' });
  assert.deepEqual(decideAccess('/admin/users', 'manager'), { kind: 'not-found' });
  assert.deepEqual(decideAccess('/admin/exams/ex-1', 'manager'), { kind: 'not-found' });
  assert.deepEqual(decideAccess('/admin/leaderboard', 'jury'), { kind: 'not-found' });
  assert.equal(canOpen('/admin/leaderboard', 'manager'), true);
  assert.equal(canOpen('/admin/exams/ex-1', 'admin'), true);
  assert.equal(canOpen('/dashboard/ambassador', 'ambassador'), true);
});

test('a prefix only matches whole segments', () => {
  assert.deepEqual(decideAccess('/dashboardx', 'student'), { kind: 'not-found' });
  assert.deepEqual(decideAccess('/admin/usersx', 'manager'), { kind: 'ok' });
  assert.deepEqual(decideAccess('/login', 'admin'), { kind: 'not-found' });
});

test('every restricted page sits in an area and names only roles of that area', () => {
  for (const { path, roles } of PAGE_ROLES) {
    assert.ok(roles.length > 0, path);
    for (const role of roles) assert.equal(canOpen(path, role), true, `${role} ${path}`);
  }
});
