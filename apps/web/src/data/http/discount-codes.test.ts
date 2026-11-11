import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discountCodesPath } from './discount-codes.ts';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet & { calls: string[] } {
  const calls: string[] = [];
  const get = (async (path: string) => {
    calls.push(path);
    return answers[path] ?? { status: 404, body: null };
  }) as ApiGet & { calls: string[] };
  get.calls = calls;
  return get;
}

const ID = '0190f000-0000-7000-8000-0000000000dc';
const code = {
  id: ID,
  code: 'DC-7K2M9QXR',
  kind: 'amount',
  value: 5000,
  maxUses: 100,
  startsAt: null,
  endsAt: '2026-12-01T00:00:00.000Z',
  active: true,
  note: 'School partners',
  ambassador: {
    userId: '0190f000-0000-7000-8000-0000000000a1',
    name: 'Nusrat',
    promoCode: 'SR-4FQ2ZD',
  },
  uses: { paid: 3, live: 1 },
  locked: true,
  status: 'active',
  demo: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
};
const use = {
  paymentId: '0190f000-0000-7000-8000-0000000000ee',
  invoiceNumber: 'T261101ABCDEFGHJK',
  userId: '0190f000-0000-7000-8000-0000000000ff',
  name: 'Rahim',
  participantId: 'ON48210937552',
  paidAt: '2026-11-03T00:00:00.000Z',
  listAmountMinor: 40000,
  discountMinor: 5000,
  amountMinor: 35000,
};

test('discountCodesPath sends only set filters, linked as 1, and caps pageSize at 50', () => {
  assert.equal(
    discountCodesPath({ page: 1, pageSize: 20 }),
    '/admin/discount-codes?page=1&pageSize=20',
  );
  assert.equal(
    discountCodesPath({ page: 2, pageSize: 100, q: 'DC-7', status: 'active', linked: true }),
    '/admin/discount-codes?page=2&pageSize=50&q=DC-7&status=active&linked=1',
  );
});

test('the list keeps only the known fields, and refuses a wrong shape', async () => {
  const page = { items: [{ ...code, internal: 'x' }], page: 1, pageSize: 20, total: 1 };
  const source = createHttpSource(
    fakeApi({ '/admin/discount-codes?page=1&pageSize=20': { status: 200, body: page } }),
  );
  const list = await source.admin.listDiscountCodes({ page: 1, pageSize: 20 });
  assert.deepEqual(list.items, [code]);
  for (const broken of [
    { ...code, kind: 'free' },
    { ...code, value: -1 },
    { ...code, uses: { paid: 1 } },
    { ...code, status: 'paused' },
    { ...code, ambassador: { userId: 'x' } },
  ]) {
    const bad = createHttpSource(
      fakeApi({
        '/admin/discount-codes?page=1&pageSize=20': {
          status: 200,
          body: { ...page, items: [broken] },
        },
      }),
    );
    await assert.rejects(bad.admin.listDiscountCodes({ page: 1, pageSize: 20 }), DataRequestError);
  }
});

test('one code, and its uses with the totals; a malformed id or a 404 is not found', async () => {
  const uses = {
    items: [{ ...use, email: 'never@shown.invalid' }],
    page: 1,
    pageSize: 20,
    total: 1,
    totals: { uses: 1, discountMinor: 5000, collectedMinor: 35000 },
  };
  const api = fakeApi({
    [`/admin/discount-codes/${ID}`]: { status: 200, body: code },
    [`/admin/discount-codes/${ID}/uses?page=1&pageSize=20`]: { status: 200, body: uses },
  });
  const source = createHttpSource(api);
  assert.deepEqual(await source.admin.getDiscountCode(ID), code);
  const got = await source.admin.listDiscountCodeUses(ID, { page: 1, pageSize: 20 });
  assert.deepEqual(got?.items, [use]);
  assert.deepEqual(got?.totals, uses.totals);
  assert.equal(await source.admin.getDiscountCode('not-an-id'), null);
  assert.equal(
    await source.admin.listDiscountCodeUses('not-an-id', { page: 1, pageSize: 20 }),
    null,
  );
  const missing = '0190f000-0000-7000-8000-0000000000aa';
  assert.equal(await source.admin.getDiscountCode(missing), null);
  assert.ok(!api.calls.some((c) => c.includes('not-an-id')));
});
