/**
 * The audit-log viewer (06-API "Audit log"; lead 2026-11-01): admins only, the list without IPs, emails or meta, keyset
 * paging that never skips or repeats a row, filters, the row detail, and the export (redacted meta, on the record,
 * 5 an hour). Rows of other suites share the table, so each test writes rows under an action family of its own.
 */
import { randomInt } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { AdminAuditDetail, AdminAuditPage } from '@sirat/shared';
import { bootCoreApp, call, sessionFor, type CoreApp } from './core-helpers';
import { makeUser, testPrisma } from './helpers';

let env: CoreApp;
let prisma: PrismaClient;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  admin = await sessionFor(env, prisma, { role: 'admin' });
});

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

/** An action family only this test writes: `t_<letters>` (actions allow letters, dots and underscores). */
const family = () =>
  `t_${Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz'[randomInt(26)]).join('')}`;

const list = (query: string, cookie = admin.cookie) =>
  call<AdminAuditPage>(env, 'GET', `/admin/audit?${query}`, cookie);

/** Follows `next` to the end, `limit` rows a page. */
async function allPages(query: string, limit: number): Promise<AdminAuditPage['items']> {
  const items: AdminAuditPage['items'] = [];
  let before: string | null = null;
  for (let i = 0; i < 50; i += 1) {
    const res = await list(`${query}&limit=${limit}${before ? `&before=${before}` : ''}`);
    expect(res.status).toBe(200);
    items.push(...res.json.items);
    if (!res.json.next) return items;
    before = res.json.next;
  }
  throw new Error('paging did not end');
}

describe('the list', () => {
  it('pages newest first, never skipping or repeating rows written in the same millisecond or microsecond', async () => {
    const f = family();
    // Same microsecond, same millisecond with different microseconds, and plain later rows.
    const times = [
      '2026-10-30T06:00:00.123456Z',
      '2026-10-30T06:00:00.123456Z',
      '2026-10-30T06:00:00.123456Z',
      '2026-10-30T06:00:00.123100Z',
      '2026-10-30T06:00:00.123900Z',
      '2026-10-30T06:00:00.123000Z',
      '2026-10-30T06:00:01.000000Z',
      '2026-10-30T06:00:02.000000Z',
      '2026-10-30T05:59:59.999999Z',
      '2026-10-30T06:00:00.124000Z',
    ];
    for (const at of times)
      await prisma.$executeRaw`
        INSERT INTO "audit_logs" ("id", "action", "created_at")
        VALUES (gen_random_uuid(), ${`${f}.paged`}, ${at}::timestamptz)`;
    const expected = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "audit_logs" WHERE "action" = ${`${f}.paged`} ORDER BY "created_at" DESC, "id" DESC`;
    for (const limit of [1, 3, 4, 50]) {
      const items = await allPages(`action=${f}.*`, limit);
      expect([limit, items.map((r) => r.id)]).toEqual([limit, expected.map((r) => r.id)]);
    }
  });

  it('filters by an action, a family, the actor (an email or system) and Asia/Dhaka days', async () => {
    const f = family();
    const a = await makeUser(prisma, { role: 'student', email: `${f}.a@test.invalid` });
    const b = await makeUser(prisma, { role: 'student' });
    const write = (action: string, actorId: string | null, createdAt: Date) =>
      prisma.auditLog.create({ data: { action: `${f}.${action}`, actorId, createdAt } });
    // 23:59 on 20 October in Dhaka is 17:59 UTC; 00:00 on 21 October is 18:00 UTC.
    await write('one', a.id, new Date('2026-10-20T17:59:00Z'));
    await write('one', b.id, new Date('2026-10-20T18:00:00Z'));
    await write('two', null, new Date('2026-10-21T17:59:59Z'));
    await write('two', a.id, new Date('2026-10-22T00:00:00Z'));
    const actions = async (q: string) =>
      (await allPages(q, 50)).map((r) => r.action.slice(f.length + 1)).sort();

    expect(await actions(`action=${f}.*`)).toEqual(['one', 'one', 'two', 'two']);
    expect(await actions(`action=${f}.one`)).toEqual(['one', 'one']);
    expect(await actions(`action=${f}.*&actor=${encodeURIComponent(a.email)}`)).toEqual([
      'one',
      'two',
    ]);
    expect(
      await actions(`action=${f}.*&actor=${encodeURIComponent(a.email.toUpperCase())}`),
    ).toEqual(['one', 'two']);
    expect(await actions(`action=${f}.*&actor=system`)).toEqual(['two']);
    expect(await actions(`action=${f}.*&actor=nobody@test.invalid`)).toEqual([]);
    expect(await actions(`action=${f}.*&from=2026-10-21&to=2026-10-21`)).toEqual(['one', 'two']);
    expect(await actions(`action=${f}.*&to=2026-10-20`)).toEqual(['one']);
    expect(await actions(`action=${f}.*&from=2026-10-22`)).toEqual(['two']);

    const system = (await list(`action=${f}.two&actor=system`)).json.items[0]!;
    expect(system).toMatchObject({ system: true, actor: null });
    const named = (await list(`action=${f}.one&actor=${encodeURIComponent(a.email)}`)).json
      .items[0]!;
    expect(named).toMatchObject({ system: false, actor: { name: a.name, role: 'student' } });
  });

  it('refuses bad filters and cursors', async () => {
    for (const [query, code] of [
      ['from=2026-02-30', 'bad_date'],
      ['from=2026-10-22&to=2026-10-21', 'bad_range'],
      [`before=${Buffer.from('not|a|cursor').toString('base64url')}`, 'bad_cursor'],
      [
        `before=${Buffer.from("2026-10-30T06:00:00.123456Z|1' OR '1'='1").toString('base64url')}`,
        'bad_cursor',
      ],
    ] as const) {
      const res = await list(query);
      expect([query, res.status, (res.json as unknown as { details: string[] }).details]).toEqual([
        query,
        400,
        [code],
      ]);
    }
    for (const query of [
      'action=Auth.Login',
      'action=auth.%25',
      'actor=someone',
      'limit=51',
      'limit=0',
      'from=21-10-2026',
      'other=1',
    ])
      expect([query, (await list(query)).status]).toEqual([query, 400]);
  });

  it('never shows an IP, an email or the meta in the list; the row detail has them', async () => {
    const f = family();
    const actor = await makeUser(prisma, { role: 'student', email: `${f}.who@test.invalid` });
    const row = await prisma.auditLog.create({
      data: {
        action: `${f}.secret`,
        actorId: actor.id,
        ip: '203.0.113.99',
        entityType: 'user',
        entityId: actor.id,
        meta: { email: 'leak.meta@test.invalid', phone: '01712345678' },
      },
    });
    const res = await list(`action=${f}.*`);
    expect(res.json.items).toHaveLength(1);
    expect(Object.keys(res.json.items[0]!).sort()).toEqual(
      ['action', 'actor', 'createdAt', 'entityId', 'entityType', 'id', 'system'].sort(),
    );
    for (const needle of [
      '203.0.113.99',
      'leak.meta',
      '01712345678',
      actor.email,
      '"ip"',
      '"meta"',
    ])
      expect([needle, res.text.includes(needle)]).toEqual([needle, false]);

    const detail = await call<AdminAuditDetail>(env, 'GET', `/admin/audit/${row.id}`, admin.cookie);
    expect(detail.status).toBe(200);
    expect(detail.json).toMatchObject({
      id: row.id,
      action: `${f}.secret`,
      ip: '203.0.113.99',
      actorEmail: actor.email,
      meta: { email: 'leak.meta@test.invalid', phone: '01712345678' },
      actor: { name: actor.name, role: 'student' },
    });
    expect(
      (await call(env, 'GET', '/admin/audit/019a0000-0000-7000-8000-000000000000', admin.cookie))
        .status,
    ).toBe(404);
    expect((await call(env, 'GET', '/admin/audit/not-a-uuid', admin.cookie)).status).toBe(400);
  });

  it('pages through the (created_at, id) index', async () => {
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
        EXPLAIN SELECT "id" FROM "audit_logs" a
        WHERE (a."created_at", a."id") < ('2026-10-30T06:00:00.123456Z'::timestamptz, gen_random_uuid())
        ORDER BY a."created_at" DESC, a."id" DESC LIMIT 26`;
    });
    expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toContain('audit_logs_created_at_id_idx');
  });
});

describe('who may read it', () => {
  it('is for admins only: manager, jury, students, ambassadors and a demoted or blocked admin get 403', async () => {
    const someId = '019a0000-0000-7000-8000-000000000000';
    for (const role of ['manager', 'jury', 'student', 'ambassador'] as const) {
      const other = await sessionFor(env, prisma, { role });
      expect([role, (await list('', other.cookie)).status]).toEqual([role, 403]);
      expect([
        role,
        (await call(env, 'GET', `/admin/audit/${someId}`, other.cookie)).status,
      ]).toEqual([role, 403]);
      expect([
        role,
        (await call(env, 'POST', '/admin/audit/export', other.cookie, { reason: 'check' })).status,
      ]).toEqual([role, 403]);
    }
    const demoted = await sessionFor(env, prisma, { role: 'admin' });
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'manager' } });
    expect((await list('', demoted.cookie)).status).toBe(403);
    const blocked = await sessionFor(env, prisma, { role: 'admin' });
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    expect((await list('', blocked.cookie)).status).toBe(403);
    expect((await list('', '')).status).toBe(401);
  });
});

describe('the export', () => {
  it('writes the filtered rows as CSV without IPs or emails, with the meta redacted, and records itself', async () => {
    const exporter = await sessionFor(env, prisma, { role: 'admin' });
    const f = family();
    const actor = await makeUser(prisma, { role: 'student', email: `${f}.csv@test.invalid` });
    for (let i = 0; i < 3; i += 1)
      await prisma.auditLog.create({
        data: {
          action: `${f}.row`,
          actorId: i === 2 ? null : actor.id,
          ip: '198.51.100.7',
          meta: { note: `wrote ${f}@example.com or 0181234567${i}`, from: '2001:db8::1', n: i },
        },
      });
    const res = await call(env, 'POST', '/admin/audit/export', exporter.cookie, {
      action: `${f}.*`,
      reason: 'Quarterly review',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="audit-log-\d{12}\.csv"$/,
    );
    expect(
      res.text.startsWith(
        '﻿time_dhaka,action,actor_name,actor_role,system,entity_type,entity_id,meta\r\n',
      ),
    ).toBe(true);
    const lines = res.text.trimEnd().split('\r\n');
    expect(lines).toHaveLength(4);
    for (const needle of [
      '198.51.100.7',
      '2001:db8',
      `${f}@example.com`,
      actor.email,
      '0181234567',
    ])
      expect([needle, res.text.includes(needle)]).toEqual([needle, false]);
    expect(res.text).toContain('[email]');
    expect(res.text).toContain('[phone]');
    expect(res.text).toContain('[ip]');
    expect(lines.filter((l) => l.includes(',yes,'))).toHaveLength(1);

    const record = await prisma.auditLog.findFirst({
      where: { action: 'audit.exported', actorId: exporter.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(record?.meta).toEqual({
      filters: { action: `${f}.*` },
      rowCount: 3,
      reason: 'Quarterly review',
    });

    const byEmail = await call(env, 'POST', '/admin/audit/export', exporter.cookie, {
      actor: actor.email,
      reason: 'One student',
    });
    expect(byEmail.status).toBe(200);
    const second = await prisma.auditLog.findFirst({
      where: { action: 'audit.exported', actorId: exporter.id, NOT: { id: record!.id } },
    });
    // The export's own record keeps the actor only as a kind, never the email.
    expect(second?.meta).toMatchObject({ filters: { actorKind: 'email' }, reason: 'One student' });
    expect(JSON.stringify(second?.meta)).not.toContain(actor.email);
  });

  it('needs a reason, and allows 5 exports per admin per hour', async () => {
    const refusals = await sessionFor(env, prisma, { role: 'admin' });
    for (const body of [
      {},
      { reason: 'ab' },
      { reason: 'x'.repeat(201) },
      { reason: 'ok reason', ip: true },
    ])
      expect([
        body,
        (await call(env, 'POST', '/admin/audit/export', refusals.cookie, body)).status,
      ]).toEqual([body, 400]);
    const busy = await sessionFor(env, prisma, { role: 'admin' });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1)
      statuses.push(
        (
          await call(env, 'POST', '/admin/audit/export', busy.cookie, {
            action: `${family()}.*`,
            reason: 'Limit check',
          })
        ).status,
      );
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
