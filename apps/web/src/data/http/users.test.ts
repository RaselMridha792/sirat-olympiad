import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';
import { usersPath } from './users.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet & { calls: string[] } {
  const calls: string[] = [];
  const get = (async (path: string) => {
    calls.push(path);
    return answers[path] ?? { status: 404, body: null };
  }) as ApiGet & { calls: string[] };
  get.calls = calls;
  return get;
}

const ID = '0190f000-0000-7000-8000-000000000001';
const row = {
  id: ID,
  name: 'Rahim',
  email: 'rahim@test.invalid',
  role: 'student',
  isBlocked: false,
  category: 'activist',
  district: 'Dhaka',
  createdAt: '2026-11-01T04:00:00.000Z',
  phoneLast3: '678',
  gradeLabel: 'Class 8',
  emailVerified: true,
  registration: {
    registeredAt: '2026-11-01T04:00:00.000Z',
    invoiceNumber: 'T261101ABCDEFGHJK2',
    paymentStatus: 'paid',
    paidAt: '2026-11-01T04:00:00.000Z',
  },
  needsPaymentReview: false,
};
const detail = {
  ...row,
  phone: '01712345678',
  institution: 'School',
  educationType: null,
  emailVerifiedAt: '2026-11-01T04:00:00.000Z',
  gradeLevel: { id: 'g8', label: 'Class 8' },
  payment: {
    status: 'paid',
    invoiceNumber: 'T261101ABCDEFGHJK2',
    amountMinor: 40000,
    currency: 'BDT',
    paidAt: '2026-11-01T04:00:00.000Z',
  },
  referredBy: null,
  ambassador: null,
};

test('the list path carries every filter, booleans as true/false, and leaves out empty ones', () => {
  assert.equal(usersPath({ page: 1, pageSize: 20 }), '/admin/users?page=1&pageSize=20');
  assert.equal(
    usersPath({
      page: 2,
      pageSize: 20,
      q: '+8801712 345678',
      role: 'student',
      blocked: true,
      category: 'achiever',
      registered: false,
      verified: false,
    }),
    '/admin/users?page=2&pageSize=20&q=%2B8801712+345678&role=student&blocked=true&category=achiever&registered=false&verified=false',
  );
});

test('admin.listUsers passes on only the row fields (no full phone, no hash)', async () => {
  const get = fakeApi({
    '/admin/users?page=1&pageSize=20': {
      status: 200,
      body: {
        items: [{ ...row, phone: '01712345678', passwordHash: '$argon2id$canary' }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    },
  });
  const page = await createHttpSource(get).admin.listUsers({ page: 1, pageSize: 20 });
  assert.deepEqual(page, { items: [row], page: 1, pageSize: 20, total: 1 });
  assert.equal(JSON.stringify(page).includes('canary'), false);
  assert.equal(JSON.stringify(page).includes('01712345678'), false);
});

test('admin.listUsers refuses a row of the wrong shape', async () => {
  for (const bad of [
    { ...row, role: 'owner' },
    { ...row, registration: { ...row.registration, paymentStatus: 'done' } },
    { ...row, emailVerified: 'yes' },
    { ...row, phoneLast3: 678 },
  ]) {
    const get = fakeApi({
      '/admin/users?page=1&pageSize=20': {
        status: 200,
        body: { items: [bad], page: 1, pageSize: 20, total: 1 },
      },
    });
    await assert.rejects(
      createHttpSource(get).admin.listUsers({ page: 1, pageSize: 20 }),
      DataRequestError,
    );
  }
});

test('admin.getUser: the detail, null for 404, and no call at all for an id that is not a UUID', async () => {
  const get = fakeApi({
    [`/admin/users/${ID}`]: { status: 200, body: { ...detail, passwordHash: 'canary' } },
  });
  const source = createHttpSource(get);
  assert.deepEqual(await source.admin.getUser(ID), detail);
  assert.equal(await source.admin.getUser('0190f000-0000-7000-8000-00000000ffff'), null);
  assert.equal(await source.admin.getUser('u-1'), null);
  assert.deepEqual(get.calls, [
    `/admin/users/${ID}`,
    '/admin/users/0190f000-0000-7000-8000-00000000ffff',
  ]);
});

test('admin.getUser passes a refusal on as an error', async () => {
  const get = fakeApi({ [`/admin/users/${ID}`]: { status: 403, body: null } });
  await assert.rejects(createHttpSource(get).admin.getUser(ID), DataRequestError);
});
