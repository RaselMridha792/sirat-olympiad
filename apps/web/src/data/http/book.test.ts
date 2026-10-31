import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookOrdersPath } from './book.ts';
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

const COVER = '/api/book/cover/0190f000-0000-7000-8000-0000000000aa';
const order = {
  status: 'confirmed',
  recipientName: 'Rahim Uddin',
  recipientPhone: '01712345678',
  district: 'Dhaka',
  upazila: 'Mirpur',
  addressLine: 'House 12, Road 3',
  note: null,
  bookTitle: 'Leadership for Tomorrow',
  version: 2,
  confirmedAt: '2026-11-01T01:00:00.000Z',
  shippedAt: null,
};

test('student.getBook keeps the title and a same-origin cover path only', async () => {
  const ok = fakeApi({
    '/book': { status: 200, body: { title: 'Book', coverUrl: COVER, extra: 'canary' } },
  });
  assert.deepEqual(await createHttpSource(ok).student.getBook(), {
    title: 'Book',
    coverUrl: COVER,
  });
  for (const coverUrl of ['https://evil.invalid/x.png', 'javascript:alert(1)', '/api/users/me'])
    await assert.rejects(
      createHttpSource(
        fakeApi({ '/book': { status: 200, body: { title: 'Book', coverUrl } } }),
      ).student.getBook(),
      DataRequestError,
    );
});

test('student.getBookOrder picks the order fields one by one (no ids, nothing added later)', async () => {
  const get = fakeApi({
    '/book-order/me': {
      status: 200,
      body: {
        eligible: true,
        order: { ...order, id: 'order-canary', userId: 'user-canary' },
        canary: 1,
      },
    },
  });
  const mine = await createHttpSource(get).student.getBookOrder();
  assert.deepEqual(mine, { eligible: true, order });
  assert.equal(JSON.stringify(mine).includes('canary'), false);
  const none = fakeApi({
    '/book-order/me': { status: 200, body: { eligible: false, order: null } },
  });
  assert.deepEqual(await createHttpSource(none).student.getBookOrder(), {
    eligible: false,
    order: null,
  });
  const bad = fakeApi({
    '/book-order/me': {
      status: 200,
      body: { eligible: true, order: { ...order, status: 'lost' } },
    },
  });
  await assert.rejects(createHttpSource(bad).student.getBookOrder(), DataRequestError);
});

test('admin.listBookOrders: the path, the picks and the shape check', async () => {
  assert.equal(
    bookOrdersPath({
      page: 2,
      pageSize: 500,
      status: 'confirmed',
      district: "Cox's Bazar",
      phone: '01712345678',
    }),
    '/admin/book-orders?page=2&pageSize=100&status=confirmed&district=Cox%27s+Bazar&phone=01712345678',
  );
  const row = {
    ...order,
    id: 'o1',
    code: 'B0000000001',
    student: { name: 'Rahim', email: 'r@test.invalid', phone: null, passwordHash: 'canary' },
  };
  const get = fakeApi({
    '/admin/book-orders?page=1&pageSize=50': {
      status: 200,
      body: { items: [row], page: 1, pageSize: 50, total: 1 },
    },
  });
  const page = await createHttpSource(get).admin.listBookOrders({ page: 1, pageSize: 50 });
  assert.equal(JSON.stringify(page).includes('canary'), false);
  assert.deepEqual(page.items[0]?.student, { name: 'Rahim', email: 'r@test.invalid', phone: null });
  const refused = fakeApi({
    '/admin/book-orders?page=1&pageSize=50': {
      status: 200,
      body: { items: [{ ...row, version: '2' }], page: 1, pageSize: 50, total: 1 },
    },
  });
  await assert.rejects(
    createHttpSource(refused).admin.listBookOrders({ page: 1, pageSize: 50 }),
    DataRequestError,
  );
});

test('admin.getBook: the cover and its limits; 403 throws', async () => {
  const body = {
    title: 'Book',
    cover: {
      id: 'c1',
      url: COVER,
      contentType: 'image/png',
      width: 400,
      height: 600,
      byteSize: 1234,
      uploadedAt: '2026-11-01T01:00:00.000Z',
      sha256: 'canary',
    },
    limits: { maxBytes: 819200, minSide: 100, maxSide: 4000, types: ['image/png'] },
  };
  const book = await createHttpSource(
    fakeApi({ '/admin/book': { status: 200, body } }),
  ).admin.getBook();
  assert.equal(book.cover?.url, COVER);
  assert.equal(JSON.stringify(book).includes('canary'), false);
  await assert.rejects(
    createHttpSource(fakeApi({ '/admin/book': { status: 403, body: null } })).admin.getBook(),
    DataRequestError,
  );
});
