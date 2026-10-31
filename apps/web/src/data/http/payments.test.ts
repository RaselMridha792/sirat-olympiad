import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpSource } from './index.ts';
import { paymentsPath } from './payments.ts';
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

const ID = '0190f000-0000-7000-8000-0000000000aa';
const apiRow = {
  id: ID,
  invoiceNumber: 'T261101ABCDEFGHJK',
  amountMinor: 40000,
  currency: 'BDT',
  status: 'pending',
  trxId: null,
  paidAmountMinor: null,
  gatewayStatus: 'success',
  gatewayAccount: 'sandbox-rasel',
  reviewReason: 'success_without_trx_id',
  checkCount: 2,
  lastCheckedAt: '2026-11-01T01:00:00.000Z',
  expiresAt: '2026-11-01T02:00:00.000Z',
  paidAt: null,
  createdAt: '2026-11-01T00:59:00.000Z',
  userId: null,
  pendingRegistration: {
    id: '0190f000-0000-7000-8000-0000000000bb',
    status: 'open',
    email: 'payer@test.invalid',
    phone: '01712345678',
    name: 'Payer',
  },
};
const { pendingRegistration, ...rowFields } = apiRow;
const pickedRow = {
  ...rowFields,
  attempt: {
    status: pendingRegistration.status,
    email: pendingRegistration.email,
    phone: pendingRegistration.phone,
    name: pendingRegistration.name,
  },
};

test('paymentsPath sends only set filters, review as 1, and caps pageSize at 50', () => {
  assert.equal(paymentsPath({ page: 1, pageSize: 20 }), '/admin/payments?page=1&pageSize=20');
  assert.equal(
    paymentsPath({
      page: 2,
      pageSize: 100,
      invoice: 'T261101ABCDEFGHJK',
      phone: '01712345678',
      email: 'a+b@test.invalid',
      status: 'paid',
      review: true,
    }),
    '/admin/payments?page=2&pageSize=50&invoice=T261101ABCDEFGHJK&phone=01712345678&email=a%2Bb%40test.invalid&status=paid&review=1',
  );
});

test('admin.listPayments picks the row fields one by one (not the attempt id, nothing added later)', async () => {
  const get = fakeApi({
    '/admin/payments?page=1&pageSize=20': {
      status: 200,
      body: {
        items: [{ ...apiRow, canary: 'gateway-canary', paymentUrl: 'https://canary.invalid' }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    },
  });
  const page = await createHttpSource(get).admin.listPayments({ page: 1, pageSize: 20 });
  assert.deepEqual(page, { items: [pickedRow], page: 1, pageSize: 20, total: 1 });
  assert.equal(JSON.stringify(page).includes('canary'), false);
  assert.equal(JSON.stringify(page).includes(pendingRegistration.id), false);
});

test('admin.listPayments refuses a row of the wrong shape', async () => {
  for (const bad of [
    { ...apiRow, status: 'refundedish' },
    { ...apiRow, amountMinor: '40000' },
    { ...apiRow, pendingRegistration: null },
  ]) {
    const get = fakeApi({
      '/admin/payments?page=1&pageSize=20': {
        status: 200,
        body: { items: [bad], page: 1, pageSize: 20, total: 1 },
      },
    });
    await assert.rejects(
      createHttpSource(get).admin.listPayments({ page: 1, pageSize: 20 }),
      DataRequestError,
    );
  }
});

test('admin.getPayment drops the stored gateway answer of each event and keeps only "by an admin"', async () => {
  const get = fakeApi({
    [`/admin/payments/${ID}`]: {
      status: 200,
      body: {
        payment: apiRow,
        events: [
          {
            id: 'ev1',
            source: 'admin',
            outcome: 'manual_paid',
            statusCode: null,
            trxStatus: null,
            trxId: 'PANEL-1',
            actorId: '0190f000-0000-7000-8000-0000000000cc',
            payload: { reason: 'canary reason' },
            createdAt: '2026-11-01T01:05:00.000Z',
          },
        ],
      },
    },
  });
  const detail = await createHttpSource(get).admin.getPayment(ID);
  assert.deepEqual(detail?.events, [
    {
      id: 'ev1',
      source: 'admin',
      outcome: 'manual_paid',
      statusCode: null,
      trxStatus: null,
      trxId: 'PANEL-1',
      byAdmin: true,
      createdAt: '2026-11-01T01:05:00.000Z',
    },
  ]);
  assert.equal(JSON.stringify(detail).includes('canary'), false);
  assert.equal(JSON.stringify(detail).includes('0190f000-0000-7000-8000-0000000000cc'), false);
});

test('admin.getPayment: 404 is null, and a non-UUID id makes no call', async () => {
  const get = fakeApi({});
  assert.equal(await createHttpSource(get).admin.getPayment(ID), null);
  assert.equal(await createHttpSource(get).admin.getPayment('../users'), null);
  assert.deepEqual(get.calls, [`/admin/payments/${ID}`]);
});

test('admin.listSettings keeps the allow-listed keys and plain values only', async () => {
  const ok = [
    { key: 'registration_fee_minor', value: 40000, updatedAt: '2026-11-01T00:00:00.000Z' },
    { key: 'registration_opens_at', value: null, updatedAt: '2026-11-01T00:00:00.000Z' },
  ];
  const get = fakeApi({ '/admin/settings': { status: 200, body: ok } });
  assert.deepEqual(await createHttpSource(get).admin.listSettings(), ok);
  for (const bad of [
    [{ key: 'jwt_secret', value: 'x', updatedAt: '2026-11-01T00:00:00.000Z' }],
    [{ key: 'registration_open', value: { nested: true }, updatedAt: '2026-11-01T00:00:00.000Z' }],
  ]) {
    const refused = fakeApi({ '/admin/settings': { status: 200, body: bad } });
    await assert.rejects(createHttpSource(refused).admin.listSettings(), DataRequestError);
  }
  const forbidden = fakeApi({ '/admin/settings': { status: 403, body: null } });
  await assert.rejects(createHttpSource(forbidden).admin.listSettings(), DataRequestError);
});
