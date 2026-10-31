/**
 * The admin students list over HTTP (06-API "Admin students list"; docs/plans/CORE-PLAN.md section 2): roles, the
 * fresh role check, search, filters, paging, the masked phone, the detail, and the CSV export with its audit row,
 * limits and batches. Boots the real AppModule against the *_test database. Every test searches by its own marker,
 * so rows of other suites never count.
 */
import type { PrismaClient } from '@prisma/client';
import type { AdminUserDetail, AdminUserRow, Paginated } from '@sirat/shared';
import {
  bootCoreApp,
  call,
  marker,
  registeredStudent,
  sessionFor,
  type CoreApp,
} from './core-helpers';
import { makeUser, testPhone, testPrisma } from './helpers';

let env: CoreApp;
let prisma: PrismaClient;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  admin = await sessionFor(env, prisma, { role: 'admin', name: 'C1 Admin' });
}, 60_000);

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

const list = (query: string, cookie = admin.cookie) =>
  call<Paginated<AdminUserRow>>(env, 'GET', `/admin/users${query}`, cookie);

const exportCsv = (body: unknown, cookie = admin.cookie) =>
  call(env, 'POST', '/admin/users/export', cookie, body);

/** Three students under one marker: registered + verified + reviewed, registered, and one without registration. */
async function threeStudents() {
  const mk = marker();
  const a = await registeredStudent(prisma, {
    name: `${mk} Alpha`,
    email: `${mk.toLowerCase()}.alpha@test.invalid`,
    phone: testPhone(),
    category: 'activist',
    district: 'Dhaka',
    emailVerifiedAt: new Date(),
  });
  await prisma.payment.update({
    where: { id: a.payment.id },
    data: { reviewReason: 'duplicate_payment' },
  });
  const b = await registeredStudent(prisma, {
    name: `${mk} Beta`,
    phone: testPhone(),
    category: 'achiever',
    isBlocked: true,
  });
  const c = await makeUser(prisma, { role: 'student', name: `${mk} Gamma`, category: 'activist' });
  return { mk, a, b, c };
}

describe('roles', () => {
  it.each(['manager', 'jury', 'student', 'ambassador'] as const)(
    '%s gets 403 on every route',
    async (role) => {
      const other = await sessionFor(env, prisma, { role });
      const target = await makeUser(prisma);
      expect((await list('', other.cookie)).status).toBe(403);
      expect((await call(env, 'GET', `/admin/users/${target.id}`, other.cookie)).status).toBe(403);
      expect(
        (await exportCsv({ filters: {}, reason: 'monthly report' }, other.cookie)).status,
      ).toBe(403);
    },
  );

  it('an admin blocked or demoted after login gets 403 with a still-valid token', async () => {
    const blocked = await sessionFor(env, prisma, { role: 'admin' });
    const demoted = await sessionFor(env, prisma, { role: 'admin' });
    expect((await list('', blocked.cookie)).status).toBe(200);
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'student' } });
    for (const who of [blocked, demoted]) {
      expect((await list('', who.cookie)).status).toBe(403);
      expect((await call(env, 'GET', `/admin/users/${who.id}`, who.cookie)).status).toBe(403);
      expect((await exportCsv({ filters: {}, reason: 'monthly report' }, who.cookie)).status).toBe(
        403,
      );
    }
  });
});

describe('GET /admin/users', () => {
  it('lists newest first with the registration, the review flag and only the last 3 phone digits', async () => {
    const { mk, a, b, c } = await threeStudents();
    const res = await list(`?q=${mk}`);
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(3);
    expect(res.json.items.map((r) => r.id)).toEqual([c.id, b.user.id, a.user.id]);
    const alpha = res.json.items.find((r) => r.id === a.user.id)!;
    expect(alpha).toMatchObject({
      name: `${mk} Alpha`,
      role: 'student',
      category: 'activist',
      district: 'Dhaka',
      phoneLast3: a.user.phone!.slice(-3),
      emailVerified: true,
      needsPaymentReview: true,
      registration: {
        invoiceNumber: a.payment.invoiceNumber,
        paymentStatus: 'paid',
        registeredAt: a.registration.createdAt.toISOString(),
      },
    });
    const gamma = res.json.items.find((r) => r.id === c.id)!;
    expect(gamma.registration).toBeNull();
    expect(gamma.needsPaymentReview).toBe(false);
    expect(gamma.phoneLast3).toBeNull();
    // The list never carries the full number, a hash or a token.
    expect(res.text).not.toContain(a.user.phone!);
    expect(res.text).not.toMatch(/passwordHash|password_hash|\$argon2|not-a-real-hash/);
    for (const row of res.json.items) expect(row).not.toHaveProperty('phone');
  });

  it('finds by name in any case, by email, by phone in its three forms and by invoice', async () => {
    const { mk, a } = await threeStudents();
    const ids = async (q: string) =>
      (await list(`?q=${encodeURIComponent(q)}`)).json.items.map((r) => r.id);
    expect(await ids(`${mk.toLowerCase()} alpha`)).toEqual([a.user.id]);
    expect(await ids(`${mk.toUpperCase()}.ALPHA@TEST`)).toEqual([a.user.id]);
    const phone = a.user.phone!;
    for (const form of [
      phone,
      `+88${phone}`,
      `88${phone}`,
      `${phone.slice(0, 5)}-${phone.slice(5)}`,
    ])
      expect(await ids(form)).toEqual([a.user.id]);
    expect(await ids(a.payment.invoiceNumber)).toEqual([a.user.id]);
    expect(await ids(a.payment.invoiceNumber.toLowerCase())).toEqual([a.user.id]);
  });

  it('applies every filter', async () => {
    const { mk, a, b, c } = await threeStudents();
    const ids = async (extra: string) =>
      (await list(`?q=${mk}&${extra}`)).json.items.map((r) => r.id).sort();
    expect(await ids('registered=true')).toEqual([a.user.id, b.user.id].sort());
    expect(await ids('registered=false')).toEqual([c.id]);
    expect(await ids('verified=true')).toEqual([a.user.id]);
    expect(await ids('verified=false')).toEqual([b.user.id, c.id].sort());
    expect(await ids('blocked=true')).toEqual([b.user.id]);
    expect(await ids('category=activist')).toEqual([a.user.id, c.id].sort());
    expect(await ids('role=admin')).toEqual([]);
  });

  it('pages on the server and refuses bad or unknown parameters', async () => {
    const { mk, a } = await threeStudents();
    const page2 = await list(`?q=${mk}&pageSize=2&page=2`);
    expect(page2.json).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page2.json.items.map((r) => r.id)).toEqual([a.user.id]);
    expect((await list(`?q=${mk}`)).json.pageSize).toBe(20);
    for (const bad of [
      '?pageSize=101',
      '?pageSize=0',
      '?page=0',
      `?q=${'x'.repeat(101)}`,
      '?blocked=yes',
      '?category=sdg',
      '?role=owner',
      '?userId=abc',
    ])
      expect((await list(bad)).status).toBe(400);
  });
});

describe('GET /admin/users/:id', () => {
  it('shows the full phone, the payment, the referrer and the ambassador profile', async () => {
    const ambassador = await registeredStudent(prisma, { role: 'ambassador', name: 'C1 Amb' });
    const code = marker().toUpperCase();
    await prisma.ambassadorProfile.create({
      data: { userId: ambassador.user.id, promoCode: code, approvedAt: new Date() },
    });
    const s = await registeredStudent(prisma, {
      phone: testPhone(),
      institution: 'Test School',
      referredById: ambassador.user.id,
    });
    const res = await call<AdminUserDetail>(env, 'GET', `/admin/users/${s.user.id}`, admin.cookie);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: s.user.id,
      phone: s.user.phone,
      phoneLast3: s.user.phone!.slice(-3),
      institution: 'Test School',
      payment: { status: 'paid', invoiceNumber: s.payment.invoiceNumber, amountMinor: 40000 },
      referredBy: { name: 'C1 Amb', promoCode: code },
      ambassador: null,
    });
    expect(res.text).not.toMatch(/passwordHash|\$argon2|not-a-real-hash/);
    const amb = await call<AdminUserDetail>(
      env,
      'GET',
      `/admin/users/${ambassador.user.id}`,
      admin.cookie,
    );
    expect(amb.json.ambassador).toMatchObject({ promoCode: code });
  });

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    const unknown = '0190f000-0000-7000-8000-000000000000';
    expect((await call(env, 'GET', `/admin/users/${unknown}`, admin.cookie)).status).toBe(404);
    expect((await call(env, 'GET', '/admin/users/not-a-uuid', admin.cookie)).status).toBe(400);
  });
});

describe('POST /admin/users/export', () => {
  const lines = (text: string) => text.replace(/^﻿/, '').split('\r\n').filter(Boolean);

  it('streams a CSV of students only, escaped, with the audit row written first', async () => {
    const exporter = await sessionFor(env, prisma, { role: 'admin' });
    const mk = marker();
    const s = await registeredStudent(prisma, {
      name: `=HYPERLINK("x") ${mk}`,
      phone: testPhone(),
      district: 'Dhaka',
      institution: 'রহিম, উচ্চ বিদ্যালয়',
    });
    await makeUser(prisma, { role: 'admin', name: `=HYPERLINK("x") ${mk} staff` });
    await makeUser(prisma, { role: 'jury', name: `=HYPERLINK("x") ${mk} jury` });
    // The marker alone has the invoice shape (letters and digits); this term is a name search that also
    // matches the two staff accounts, which must still stay out of the file.
    const res = await exportCsv(
      { filters: { q: `HYPERLINK("x") ${mk}` }, reason: 'courier list for the client' },
      exporter.cookie,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="students-\d{12}\.csv"$/,
    );
    expect(res.text.startsWith('﻿')).toBe(true);
    const rows = lines(res.text);
    expect(rows[0]).toBe(
      'user_id,name,email,phone,district,institution,education_type,grade_level,category,role,blocked,email_verified,registered_at,invoice,amount_bdt,payment_status,paid_at,referrer_promo_code',
    );
    expect(rows).toHaveLength(2); // staff accounts are never exported
    expect(rows[1]).toContain(`"'=HYPERLINK(""x"") ${mk}"`);
    expect(rows[1]).toContain('"রহিম, উচ্চ বিদ্যালয়"');
    expect(rows[1]).toContain(`,${s.user.phone},`);
    expect(rows[1]).toContain(`,${s.payment.invoiceNumber},400,paid,`);

    const audits = await prisma.auditLog.findMany({
      where: { actorId: exporter.id, action: 'users.exported' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.ip).toBeTruthy();
    expect(audits[0]!.meta).toEqual({
      filters: { qKind: 'name' },
      rowCount: 1,
      reason: 'courier list for the client',
    });
    // The audit row names the kind of search, never the term or a row.
    expect(JSON.stringify(audits[0])).not.toContain(mk);
    expect(JSON.stringify(audits[0])).not.toContain(s.user.phone!);
  });

  it('needs a reason and refuses unknown fields', async () => {
    // A fresh admin per body: the export's limit counts refused requests too (the throttler runs first).
    for (const body of [
      { filters: {} },
      { filters: {}, reason: 'ab' },
      { filters: {}, reason: 'x'.repeat(201) },
      { reason: 'monthly report' },
      { filters: { q: 'abc', userId: 'x' }, reason: 'monthly report' },
      { filters: {}, reason: 'monthly report', role: 'admin' },
    ]) {
      const fresh = await sessionFor(env, prisma, { role: 'admin' });
      expect((await exportCsv(body, fresh.cookie)).status).toBe(400);
    }
  });

  it('reads in keyset batches (no query per row) and keeps equal timestamps in order', async () => {
    const exporter = await sessionFor(env, prisma, { role: 'admin' });
    const mk = marker();
    // createMany gives every row the same created_at, so only the id tie-break keeps the keyset order.
    await prisma.user.createMany({
      data: Array.from({ length: 2_500 }, (_, i) => ({
        email: `${mk.toLowerCase()}.${i}@test.invalid`,
        passwordHash: 'not-a-real-hash',
        name: `${mk} ${i}`,
        role: 'student' as const,
      })),
    });
    const before = env.appPrisma.statements.length;
    const res = await exportCsv({ filters: { q: mk }, reason: 'batch check' }, exporter.cookie);
    const sent = env.appPrisma.statements.length - before;
    expect(res.status).toBe(200);
    const rows = lines(res.text).slice(1);
    expect(rows).toHaveLength(2_500);
    expect(new Set(rows.map((r) => r.split(',')[0])).size).toBe(2_500);
    // 3 batches with a fixed number of relation reads each, plus the role check, the count and the audit row.
    expect(sent).toBeLessThan(50);
  }, 60_000);

  it('refuses a sixth export within the hour for the same admin', async () => {
    const exporter = await sessionFor(env, prisma, { role: 'admin' });
    const body = { filters: { q: marker() }, reason: 'limit check' };
    for (let i = 0; i < 5; i += 1)
      expect((await exportCsv(body, exporter.cookie)).status).toBe(200);
    expect((await exportCsv(body, exporter.cookie)).status).toBe(429);
    // Another admin still has their own budget.
    const other = await sessionFor(env, prisma, { role: 'admin' });
    expect((await exportCsv(body, other.cookie)).status).toBe(200);
  });
});
