/**
 * The student's free book over HTTP (docs/plans/PAYMENTS-PLAN.md 16.3, 16.6; owner B1–B5): only with a paid
 * registration, "me" routes only, the address editable until shipped, the title kept as confirmed, unknown fields
 * refused, and no address in the audit rows.
 */
import { makeUser } from './helpers';
import {
  ADDRESS,
  bootBookApp,
  caller,
  loginAs,
  paidStudentSession,
  type BookApp,
} from './book-app';

let env: BookApp;
let call: ReturnType<typeof caller>;

beforeAll(async () => {
  env = await bootBookApp();
  call = caller(env.base);
}, 60_000);

afterAll(async () => {
  await env?.close();
});

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe('GET /book and /book-order/me', () => {
  it('shows the book to a student; staff and visitors get 403 and 401', async () => {
    const student = await paidStudentSession(env);
    const res = await call('GET', '/book', { cookie: student.cookie });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ title: 'Sirat Leadership Olympiad book', coverUrl: null });
    expect((await call('GET', '/book')).status).toBe(401);
    for (const role of ['admin', 'manager'] as const) {
      const { cookie } = await loginAs(env, role);
      expect((await call('GET', '/book-order/me', { cookie })).status).toBe(403);
    }
  });

  it('without a paid registration: not eligible, and saving an address is 403', async () => {
    const { cookie } = await loginAs(env, 'student');
    expect(await json(await call('GET', '/book-order/me', { cookie }))).toEqual({
      eligible: false,
      order: null,
    });
    const res = await call('PUT', '/book-order/me', { cookie, body: ADDRESS });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ code: 'BOOK_NOT_ELIGIBLE' });
  });
});

describe('PUT /book-order/me', () => {
  it('creates the order, then changes it with the version; a stale version is 409', async () => {
    const s = await paidStudentSession(env);
    const first = await call('PUT', '/book-order/me', {
      cookie: s.cookie,
      body: { ...ADDRESS, recipientPhone: '+880 1712-345678' },
    });
    expect(first.status).toBe(200);
    expect(await json(first)).toMatchObject({
      status: 'confirmed',
      recipientPhone: '01712345678',
      district: 'Dhaka',
      bookTitle: 'Sirat Leadership Olympiad book',
      version: 1,
      shippedAt: null,
    });
    const second = await call('PUT', '/book-order/me', {
      cookie: s.cookie,
      body: { ...ADDRESS, upazila: 'Pallabi', note: '', expectedVersion: 1 },
    });
    expect(await json(second)).toMatchObject({ upazila: 'Pallabi', note: null, version: 2 });
    const stale = await call('PUT', '/book-order/me', {
      cookie: s.cookie,
      body: { ...ADDRESS, expectedVersion: 1 },
    });
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ code: 'BOOK_ORDER_CHANGED' });
    expect(await json(await call('GET', '/book-order/me', { cookie: s.cookie }))).toMatchObject({
      eligible: true,
      order: { upazila: 'Pallabi', version: 2 },
    });
  });

  it('refuses unknown fields, a bad phone, a district outside the 64, and no CSRF header', async () => {
    const s = await paidStudentSession(env);
    for (const extra of [
      { role: 'admin' },
      { userId: s.user.id },
      { status: 'shipped' },
      { bookTitle: 'x' },
    ])
      expect(
        (await call('PUT', '/book-order/me', { cookie: s.cookie, body: { ...ADDRESS, ...extra } }))
          .status,
      ).toBe(400);
    for (const bad of [
      { recipientPhone: '01212345678' },
      { district: 'Atlantis' },
      { addressLine: 'abc' },
    ])
      expect(
        (await call('PUT', '/book-order/me', { cookie: s.cookie, body: { ...ADDRESS, ...bad } }))
          .status,
      ).toBe(400);
    expect(
      (await call('PUT', '/book-order/me', { cookie: s.cookie, body: ADDRESS, csrf: false }))
        .status,
    ).toBe(403);
    expect(await env.prisma.bookOrder.count({ where: { userId: s.user.id } })).toBe(0);
  });

  it('each student reaches only their own order', async () => {
    const a = await paidStudentSession(env);
    const b = await paidStudentSession(env);
    await call('PUT', '/book-order/me', { cookie: a.cookie, body: ADDRESS });
    expect(await json(await call('GET', '/book-order/me', { cookie: b.cookie }))).toEqual({
      eligible: true,
      order: null,
    });
    await call('PUT', '/book-order/me', {
      cookie: b.cookie,
      body: { ...ADDRESS, upazila: 'Uttara' },
    });
    const orders = await env.prisma.bookOrder.findMany({
      where: { userId: { in: [a.user.id, b.user.id] } },
      select: { userId: true, upazila: true },
    });
    expect(orders.find((o) => o.userId === a.user.id)?.upazila).toBe('Mirpur');
    expect(orders.find((o) => o.userId === b.user.id)?.upazila).toBe('Uttara');
  });

  it('keeps the title the order was confirmed with after the admin renames the book', async () => {
    const s = await paidStudentSession(env);
    await call('PUT', '/book-order/me', { cookie: s.cookie, body: ADDRESS });
    await env.prisma.setting.update({
      where: { key: 'book_title' },
      data: { value: 'A new title' },
    });
    try {
      const again = await call('PUT', '/book-order/me', {
        cookie: s.cookie,
        body: { ...ADDRESS, expectedVersion: 1 },
      });
      expect(await json(again)).toMatchObject({ bookTitle: 'Sirat Leadership Olympiad book' });
      const later = await paidStudentSession(env);
      expect(
        await json(await call('PUT', '/book-order/me', { cookie: later.cookie, body: ADDRESS })),
      ).toMatchObject({ bookTitle: 'A new title' });
    } finally {
      await env.prisma.setting.update({
        where: { key: 'book_title' },
        data: { value: 'Sirat Leadership Olympiad book' },
      });
    }
  });

  it('once shipped, the address cannot change: 409', async () => {
    const s = await paidStudentSession(env);
    await call('PUT', '/book-order/me', { cookie: s.cookie, body: ADDRESS });
    const admin = await makeUser(env.prisma, { role: 'admin' });
    await env.prisma.bookOrder.update({
      where: { userId: s.user.id },
      data: { status: 'shipped', shippedAt: new Date(), shippedBy: admin.id },
    });
    const res = await call('PUT', '/book-order/me', {
      cookie: s.cookie,
      body: { ...ADDRESS, upazila: 'Uttara' },
    });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ code: 'BOOK_ORDER_SHIPPED' });
    expect(await json(await call('GET', '/book-order/me', { cookie: s.cookie }))).toMatchObject({
      order: { status: 'shipped', upazila: 'Mirpur' },
    });
  });

  it('audits with ids only: no address, phone or note in the audit rows', async () => {
    const s = await paidStudentSession(env);
    await call('PUT', '/book-order/me', { cookie: s.cookie, body: ADDRESS });
    await call('PUT', '/book-order/me', {
      cookie: s.cookie,
      body: { ...ADDRESS, addressLine: 'Flat 4B, Lake Road 9' },
    });
    const rows = await env.prisma.auditLog.findMany({
      where: { actorId: s.user.id, action: { startsWith: 'book_order.' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.action)).toEqual(['book_order.confirmed', 'book_order.updated']);
    const text = JSON.stringify(rows);
    for (const secret of ['House 12', 'Lake Road', '01712345678', 'Rahim', 'Call before', 'Mirpur'])
      expect(text).not.toContain(secret);
  });
});
