/**
 * The free book for admins over HTTP (docs/plans/PAYMENTS-PLAN.md 16.3, 16.5, 16.6): admin only; the title with
 * `expected`; the cover upload (magic bytes, size, metadata stripped) and the public cover's headers; the orders
 * list and its search; the courier CSV (BOM, formula-injection safety, an audit row without rows); shipping.
 */
import { crc32, deflateSync } from 'node:zlib';
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
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootBookApp();
  call = caller(env.base);
  admin = await loginAs(env, 'admin');
}, 60_000);

afterAll(async () => {
  await env?.close();
});

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head, data])));
  return Buffer.concat([len, head, data, crc]);
}
/** A real grayscale PNG with a text chunk that must not survive the upload. */
function png(width: number, height: number, text = 'GPS 23.81,90.41'): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1')),
    pngChunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const upload = (bytes: Buffer, name: string, type: string, cookie = admin.cookie) => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
  return call('POST', '/admin/book/cover', { cookie, form });
};

describe('admin only', () => {
  it('a student and a manager get 403 on every admin book route', async () => {
    for (const role of ['student', 'manager'] as const) {
      const { cookie } = await loginAs(env, role);
      const routes: [string, string, unknown?][] = [
        ['GET', '/admin/book'],
        ['PUT', '/admin/book/title', { title: 'x', expected: 'y', reason: 'why' }],
        ['GET', '/admin/book-orders'],
        ['GET', '/admin/book-orders/export.csv'],
        ['POST', '/admin/book-orders/ship', { ids: [admin.id] }],
      ];
      for (const [method, path, body] of routes)
        expect([path, (await call(method, path, { cookie, body })).status]).toEqual([path, 403]);
      expect((await upload(png(200, 300), 'c.png', 'image/png', cookie)).status).toBe(403);
    }
  });
});

describe('the title and the cover', () => {
  it('changes the title from the value the admin saw (409 when stale), audited', async () => {
    const current = (await json(await call('GET', '/admin/book', { cookie: admin.cookie }))).title;
    const stale = await call('PUT', '/admin/book/title', {
      cookie: admin.cookie,
      body: { title: 'New title', expected: 'not the current one', reason: 'Owner decision' },
    });
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ code: 'SETTING_CHANGED' });
    const ok = await call('PUT', '/admin/book/title', {
      cookie: admin.cookie,
      body: { title: '  Leadership   for Tomorrow ', expected: current, reason: 'Owner decision' },
    });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ title: 'Leadership for Tomorrow' });
    expect(
      await env.prisma.auditLog.findFirst({
        where: { action: 'book.title_changed' },
        orderBy: { createdAt: 'desc' },
      }),
    ).toMatchObject({
      actorId: admin.id,
      meta: { old: current, new: 'Leadership for Tomorrow', reason: 'Owner decision' },
    });
  });

  it('stores a cover by its magic bytes, stripped, and serves it with fixed headers to anyone', async () => {
    // A PNG named .svg and sent as image/svg+xml: the bytes decide.
    const res = await upload(png(400, 600), 'cover.svg', 'image/svg+xml');
    expect(res.status).toBe(200);
    const book = await json(res);
    const cover = book.cover as { id: string; url: string; contentType: string; width: number };
    expect(cover).toMatchObject({ contentType: 'image/png', width: 400, height: 600 });
    const audit = await env.prisma.auditLog.findFirst({
      where: { action: 'book.cover_changed', entityId: cover.id },
    });
    expect(audit).toMatchObject({ actorId: admin.id, meta: { newImageId: cover.id } });

    const served = await fetch(`${env.base}${cover.url}`); // no session
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(served.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const bytes = Buffer.from(await served.arrayBuffer());
    expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(bytes.toString('latin1')).not.toContain('GPS 23.81');

    // The same image again reuses the stored one; the student's book shows the new cover.
    const again = await json(await upload(png(400, 600), 'again.png', 'image/png'));
    expect((again.cover as { id: string }).id).toBe(cover.id);
    const student = await paidStudentSession(env);
    expect(await json(await call('GET', '/book', { cookie: student.cookie }))).toMatchObject({
      coverUrl: cover.url,
    });
  });

  it('refuses SVG, GIF, a missing file, bad sides, and more than 800 KB (413)', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(100)]);
    const cases: [Buffer, string, number, string][] = [
      [svg, 'image/png', 400, 'COVER_UNSUPPORTED_TYPE'],
      [gif, 'image/gif', 400, 'COVER_UNSUPPORTED_TYPE'],
      [png(50, 300), 'image/png', 400, 'COVER_BAD_DIMENSIONS'],
    ];
    for (const [bytes, type, status, code] of cases) {
      const res = await upload(bytes, 'x', type);
      expect([res.status, (await json(res)).code]).toEqual([status, code]);
    }
    const big = Buffer.concat([png(200, 200), Buffer.alloc(820_000)]);
    expect((await upload(big, 'big.png', 'image/png')).status).toBe(413);
    const none = await call('POST', '/admin/book/cover', {
      cookie: admin.cookie,
      form: new FormData(),
    });
    expect([none.status, (await json(none)).code]).toEqual([400, 'COVER_MISSING']);
  });

  it('the cover route: 404 for an unknown id, 400 for a malformed one', async () => {
    expect(
      (await fetch(`${env.base}/api/book/cover/0190f000-0000-7000-8000-000000000000`)).status,
    ).toBe(404);
    expect((await fetch(`${env.base}/api/book/cover/not-an-id`)).status).toBe(400);
  });
});

describe('orders: list, courier CSV, ship', () => {
  let first: Awaited<ReturnType<typeof paidStudentSession>>;
  let second: Awaited<ReturnType<typeof paidStudentSession>>;

  beforeAll(async () => {
    first = await paidStudentSession(env, { email: `Mixed.Case.${Date.now()}@test.invalid` });
    second = await paidStudentSession(env);
    await call('PUT', '/book-order/me', {
      cookie: first.cookie,
      body: {
        ...ADDRESS,
        recipientName: '=HYPERLINK("http://evil.invalid","click")',
        recipientPhone: '01811111111',
        district: "Cox's Bazar",
        note: 'দরজায় "কল" করুন, ধন্যবাদ\nদ্বিতীয় লাইন',
      },
    });
    await call('PUT', '/book-order/me', { cookie: second.cookie, body: ADDRESS });
  });

  const list = async (q: string) =>
    (await json(await call('GET', `/admin/book-orders?${q}`, { cookie: admin.cookie }))) as {
      items: { id: string; code: string; student: { email: string } }[];
      total: number;
    };

  it('finds orders by phone (any form, recipient or student), email (any case), district and status', async () => {
    for (const phone of ['01811111111', '%2B8801811111111', '8801811111111'])
      expect((await list(`phone=${phone}`)).items.map((o) => o.id)).toHaveLength(1);
    const studentPhone = second.user.phone as string;
    expect((await list(`phone=${studentPhone}`)).items).toHaveLength(1);
    expect(
      (await list(`email=${encodeURIComponent(first.user.email.toUpperCase())}`)).items[0]?.student
        .email,
    ).toBe(first.user.email);
    expect((await list(`district=${encodeURIComponent("Cox's Bazar")}`)).total).toBe(1);
    expect((await list('status=confirmed&pageSize=1')).items).toHaveLength(1);
    expect(
      (await call('GET', '/admin/book-orders?pageSize=101', { cookie: admin.cookie })).status,
    ).toBe(400);
  });

  it('exports the courier CSV: BOM, escaping, formula injection made text; audited without rows', async () => {
    const res = await call(
      'GET',
      `/admin/book-orders/export.csv?district=${encodeURIComponent("Cox's Bazar")}`,
      {
        cookie: admin.cookie,
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="book-orders-\d{8}-\d{4}\.csv"$/,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf])); // the UTF-8 BOM
    const text = bytes.toString('utf8').slice(1);
    const [header, row] = text.split('\r\n');
    expect(header).toBe('Order,Recipient,Phone,District,Upazila/Thana,Address,Note,Book');
    expect(row).toMatch(
      /^B[0-9A-F]{10},"'=HYPERLINK\(""http:\/\/evil\.invalid"",""click""\)",01811111111,Cox's Bazar,Mirpur,/,
    );
    // Quotes and commas escaped, Bangla kept. The form squashes whitespace, so a newline in a note arrives as a space
    // (newlines inside cells are covered by core's csv.spec).
    expect(text).toContain('"দরজায় ""কল"" করুন, ধন্যবাদ দ্বিতীয় লাইন"');
    const audit = await env.prisma.auditLog.findFirst({
      where: { action: 'book_orders.exported', actorId: admin.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.meta).toEqual({ status: null, district: "Cox's Bazar", count: 1 });
    expect(JSON.stringify(audit)).not.toContain('01811111111');
  });

  it('ships the chosen orders once; the student can no longer change the address', async () => {
    const ids = (await list('status=confirmed')).items.map((o) => o.id);
    const res = await call('POST', '/admin/book-orders/ship', {
      cookie: admin.cookie,
      body: { ids, reason: 'Courier pickup' },
    });
    expect(await json(res)).toEqual({ shipped: ids.length });
    const again = await call('POST', '/admin/book-orders/ship', {
      cookie: admin.cookie,
      body: { ids },
    });
    expect(await json(again)).toEqual({ shipped: 0 });
    expect(
      await env.prisma.auditLog.findFirst({
        where: { action: 'book_orders.shipped', actorId: admin.id },
        orderBy: { createdAt: 'asc' },
      }),
    ).toMatchObject({ meta: { count: ids.length, reason: 'Courier pickup' } });
    const order = await env.prisma.bookOrder.findUniqueOrThrow({
      where: { userId: second.user.id },
    });
    expect(order).toMatchObject({ status: 'shipped', shippedBy: admin.id });
    expect(
      (await call('PUT', '/book-order/me', { cookie: second.cookie, body: ADDRESS })).status,
    ).toBe(409);
    const manager = await makeUser(env.prisma, { role: 'manager' });
    expect(manager.role).toBe('manager');
    expect(
      (await call('POST', '/admin/book-orders/ship', { cookie: admin.cookie, body: { ids: [] } }))
        .status,
    ).toBe(400);
  });
});
