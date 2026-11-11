/**
 * Certificate templates, signature images and the single manual issue (C1; DECISIONS "Certificate templates"):
 * admins only; a template is versioned and a version never changes (the database refuses it); one active version per
 * type, and a certificate keeps the version it was issued with (issue-one and core's batch issuer); plain text with
 * {name}, {round} and {date} only, checked by the DTO and by CHECKs; images PNG or JPEG by magic bytes within the size
 * and header-pixel caps, served with headers that never let them render; issue-one fits the type to the round, keeps
 * demo and real apart, and is audited with its reason.
 */
import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import type { PrismaClient } from '@prisma/client';
import type {
  AdminCertificateTemplate,
  AdminCertificateTemplateRow,
  CertificateImageInfo,
  CertificateIssueOneResult,
  Paginated,
} from '@sirat/shared';
import type Redis from 'ioredis';
import { CertificateIssuer } from '../src/modules/certificates/certificate-issuer';
import type { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CACHE } from '../src/redis/redis.module';
import { bootCoreApp, call, registeredStudent, sessionFor, type CoreApp } from './core-helpers';
import { applyReferenceData, makeUser, testPrisma } from './helpers';

let env: CoreApp;
let prisma: PrismaClient;
let redis: Redis;
let admin: { id: string; cookie: string };
let round1: { id: string };
/** This suite's rounds: a later quiz round and a final (real), and a demo first round. */
const rounds: { later?: string; final?: string; demo?: string } = {};
let demoBatchId: string | null = null;

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  redis = env.app.get(REDIS_CACHE);
  if (!(await prisma.round.findUnique({ where: { sortOrder: 1 } })))
    await applyReferenceData(prisma);
  round1 = await prisma.round.findUniqueOrThrow({ where: { sortOrder: 1 }, select: { id: true } });
  admin = await sessionFor(env, prisma, { role: 'admin' });
  // Real rounds at sort orders nobody uses (other suites' rounds stay as they are).
  const used = new Set(
    (await prisma.round.findMany({ select: { sortOrder: true } })).map((r) => r.sortOrder),
  );
  const free = [2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => !used.has(n));
  if (free.length < 2) throw new Error('no free real round sort orders');
  const tag = randomUUID().slice(0, 6);
  rounds.later = (
    await prisma.round.create({
      data: { name: `C1 later ${tag}`, sortOrder: free[0]!, type: 'quiz' },
    })
  ).id;
  rounds.final = (
    await prisma.round.create({
      data: { name: `C1 final ${tag}`, sortOrder: free[1]!, type: 'final' },
    })
  ).id;
  if ((await prisma.demoBatch.count()) > 0)
    throw new Error('a demo batch is left from another suite');
  demoBatchId = (await prisma.demoBatch.create({ data: { status: 'loaded', reason: 'C1 test' } }))
    .id;
  rounds.demo = (
    await prisma.round.create({
      data: { name: 'DEMO · C1', sortOrder: 101, type: 'quiz', demoBatchId },
    })
  ).id;
  await prisma.demoRecord.create({
    data: { batchId: demoBatchId, tableName: 'rounds', rowId: rounds.demo },
  });
}, 60_000);

beforeEach(async () => {
  // Templates refuse DELETE by design; the *_test database starts each test with none (TRUNCATE skips row triggers).
  await prisma.$executeRawUnsafe(
    'TRUNCATE "certificates", "certificate_template_signatories", "certificate_templates", "certificate_images"',
  );
  const keys = await redis.keys('throttle:*');
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  if (prisma) {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "certificates", "certificate_template_signatories", "certificate_templates", "certificate_images"',
    );
    await prisma.$executeRaw`DELETE FROM "round_entries" WHERE "round_id" = ANY (${[rounds.later, rounds.final].filter(Boolean)}::uuid[])`;
    await prisma.round.deleteMany({
      where: { id: { in: [rounds.later, rounds.final].filter((x): x is string => !!x) } },
    });
    if (demoBatchId) {
      const users = await prisma.user.findMany({ where: { demoBatchId }, select: { id: true } });
      await prisma.demoRecord.createMany({
        data: users.map((u) => ({ batchId: demoBatchId!, tableName: 'users', rowId: u.id })),
        skipDuplicates: true,
      });
      await prisma.$queryRaw`SELECT demo_clear(${demoBatchId}::uuid)`;
    }
  }
  await env?.app.close();
  await prisma?.$disconnect();
});

// ───────────── helpers ─────────────

const details = (json: unknown) => (json as { details?: string[] }).details;
const be32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const be16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.from(type, 'latin1');
  return Buffer.concat([be32(data.length), head, data, be32(crc32(Buffer.concat([head, data])))]);
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A grayscale PNG whose header claims width × height; `pixels: false` keeps the image data tiny (a bomb's shape). */
function png(width: number, height: number, pixels = true): Buffer {
  const ihdr = Buffer.concat([be32(width), be32(height), Buffer.from([8, 0, 0, 0, 0])]);
  const rows = pixels ? Buffer.alloc((width + 1) * height) : Buffer.alloc(16);
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from('Comment\0GPS 23.81,90.41', 'latin1')),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const segment = (marker: number, payload: Buffer) =>
  Buffer.concat([Buffer.from([0xff, marker]), be16(payload.length + 2), payload]);
/** A baseline JPEG container with EXIF (GPS) that must not survive. */
function jpeg(width: number, height: number): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    segment(0xe1, Buffer.from('Exif\0\0GPSLatitude 23.8103', 'latin1')),
    segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    segment(
      0xc0,
      Buffer.concat([Buffer.from([8]), be16(height), be16(width), Buffer.from([1, 1, 0x11, 0])]),
    ),
    segment(0xc4, Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 0), Buffer.from([0])])),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]),
    Buffer.from([0xff, 0xd9]),
  ]);
}
/** A lossless WebP (a cover may be one; a signature may not). */
function webp(width: number, height: number): Buffer {
  const vp8l = Buffer.alloc(9);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  const chunk = Buffer.concat([
    Buffer.from('VP8L', 'latin1'),
    Buffer.alloc(4),
    vp8l,
    Buffer.alloc(1),
  ]);
  chunk.writeUInt32LE(vp8l.length, 4);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(4 + chunk.length);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, Buffer.from('WEBP', 'latin1'), chunk]);
}

function upload(bytes: Buffer, name: string, type: string, cookie = admin.cookie) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
  return fetch(`${env.base}/api/admin/certificate-images`, {
    method: 'POST',
    headers: { cookie, 'x-requested-with': 'XMLHttpRequest' },
    body: form,
  });
}
async function uploaded(bytes: Buffer): Promise<CertificateImageInfo> {
  const res = await upload(bytes, 'sig.png', 'image/png');
  expect(res.status).toBe(201);
  return (await res.json()) as CertificateImageInfo;
}

const signatory = (imageId: string | null = null, n = 1) => ({
  nameEn: `Signer ${n}`,
  nameBn: `স্বাক্ষরকারী ${n}`,
  titleEn: 'Convener',
  titleBn: 'আহ্বায়ক',
  imageId,
});
const template = (over: Record<string, unknown> = {}) => ({
  type: 'participation',
  titleEn: 'Certificate of Participation',
  titleBn: 'অংশগ্রহণের সনদ',
  bodyEn: 'This certifies that {name} took part in {round} on {date}.',
  bodyBn: 'এই মর্মে প্রত্যয়ন করা হচ্ছে যে {name} {date} তারিখে {round}-এ অংশ নিয়েছেন।',
  signatories: [signatory()],
  ...over,
});
/** The version body: a template without its type. */
const versionBody: Record<string, unknown> = template();
delete versionBody.type;

async function create(over: Record<string, unknown> = {}) {
  const res = await call<AdminCertificateTemplate>(
    env,
    'POST',
    '/admin/certificate-templates',
    admin.cookie,
    template(over),
  );
  expect([res.status, details(res.json)]).toEqual([201, undefined]);
  return res.json;
}
const version = (id: string, body: Record<string, unknown> = versionBody) =>
  call<AdminCertificateTemplate>(
    env,
    'POST',
    `/admin/certificate-templates/${id}/versions`,
    admin.cookie,
    body,
  );
const activate = (id: string, cookie = admin.cookie) =>
  call<AdminCertificateTemplate>(
    env,
    'POST',
    `/admin/certificate-templates/${id}/activate`,
    cookie,
  );
const issueOne = (body: Record<string, unknown>, cookie = admin.cookie) =>
  call<CertificateIssueOneResult>(env, 'POST', '/admin/certificates/issue-one', cookie, body);
const lastAudit = (action: string) =>
  prisma.auditLog.findFirst({ where: { action }, orderBy: { createdAt: 'desc' } });

async function student(data: Parameters<typeof registeredStudent>[1] = {}) {
  return (await registeredStudent(prisma, { name: 'Nusrat Jahan', ...data })).user;
}

// ───────────── tests ─────────────

describe('admins only', () => {
  it('401 without a session, 403 for every other role on every route', async () => {
    const id = randomUUID();
    const routes: [string, string, unknown?][] = [
      ['GET', '/admin/certificate-templates'],
      ['GET', `/admin/certificate-templates/${id}`],
      ['POST', '/admin/certificate-templates', template()],
      ['POST', `/admin/certificate-templates/${id}/versions`, versionBody],
      ['POST', `/admin/certificate-templates/${id}/activate`],
      ['GET', `/admin/certificate-images/${id}`],
      [
        'POST',
        '/admin/certificates/issue-one',
        { email: 'a@b.test', type: 'participation', roundId: id, reason: 'why' },
      ],
    ];
    for (const [method, path, body] of routes)
      expect([path, (await call(env, method, path, '', body)).status]).toEqual([path, 401]);
    for (const role of ['student', 'ambassador', 'manager', 'jury'] as const) {
      const s = await sessionFor(env, prisma, { role });
      for (const [method, path, body] of routes)
        expect([role, path, (await call(env, method, path, s.cookie, body)).status]).toEqual([
          role,
          path,
          403,
        ]);
      expect((await upload(png(40, 20), 's.png', 'image/png', s.cookie)).status).toBe(403);
    }
    expect(await prisma.certificateTemplate.count()).toBe(0);
    expect(await prisma.certificateImage.count()).toBe(0);
  });
});

describe('templates', () => {
  it('creates version 1 (not active), audited; a new version leaves the old one as it was', async () => {
    const image = await uploaded(png(300, 100));
    const v1 = await create({ signatories: [signatory(image.id, 1), signatory(null, 2)] });
    expect(v1).toMatchObject({
      version: 1,
      type: 'participation',
      active: false,
      issuedCount: 0,
      signatories: [
        { position: 1, nameEn: 'Signer 1', imageId: image.id },
        { position: 2, nameEn: 'Signer 2', imageId: null },
      ],
    });
    expect(await lastAudit('certificate_templates.created')).toMatchObject({
      actorId: admin.id,
      entityId: v1.id,
      meta: { type: 'participation', version: 1, signatories: 2 },
    });

    const edited = await version(v1.id, { ...versionBody, titleEn: 'Participation Award' });
    expect(edited.status).toBe(201);
    expect(edited.json).toMatchObject({
      lineageId: v1.lineageId,
      version: 2,
      titleEn: 'Participation Award',
      active: false,
      signatories: [{ position: 1, nameEn: 'Signer 1', imageId: null }],
    });
    // An edit of version 1 (not the latest) still makes the next number.
    expect((await version(v1.id)).json.version).toBe(3);
    const again = await call<AdminCertificateTemplate>(
      env,
      'GET',
      `/admin/certificate-templates/${v1.id}`,
      admin.cookie,
    );
    expect(again.json).toEqual(v1);
    expect(await lastAudit('certificate_templates.versioned')).toMatchObject({
      meta: { version: 3, from: v1.id },
    });

    const list = await call<Paginated<AdminCertificateTemplateRow>>(
      env,
      'GET',
      '/admin/certificate-templates',
      admin.cookie,
    );
    expect(list.json).toEqual({
      items: [
        expect.objectContaining({
          lineageId: v1.lineageId,
          versions: 3,
          active: null,
          latest: expect.objectContaining({ version: 3 }),
        }),
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect((await version(randomUUID())).status).toBe(404);
  });

  it('one active version per type: activating one stops the other, audited; idempotent', async () => {
    const a = await create();
    const b = (await version(a.id)).json;
    const winner = await create({ type: 'winner', titleEn: 'Winner', titleBn: 'বিজয়ী' });
    expect((await activate(a.id)).json.active).toBe(true);
    expect((await activate(winner.id)).json.active).toBe(true);
    const res = await activate(b.id);
    expect([res.status, res.json.active]).toEqual([200, true]);
    expect(await lastAudit('certificate_templates.activated')).toMatchObject({
      entityId: b.id,
      meta: { type: 'participation', version: 2, previous: a.id },
    });
    expect((await activate(b.id)).status).toBe(200);
    const active = await prisma.certificateTemplate.findMany({
      where: { active: true },
      select: { id: true },
      orderBy: { type: 'asc' },
    });
    expect(active.map((r) => r.id).sort()).toEqual([b.id, winner.id].sort());
    expect((await activate(randomUUID())).status).toBe(404);
    // The database keeps one active per type even without the service.
    await expect(
      prisma.certificateTemplate.update({ where: { id: a.id }, data: { active: true } }),
    ).rejects.toThrow(/certificate_templates_one_active|Unique constraint/);
  });

  it('lists one row per template, paged and filtered by type (pageSize at most 50)', async () => {
    const p1 = await create();
    const p2 = await create({ titleEn: 'Second participation' });
    const w = await create({ type: 'winner', titleEn: 'Winner', titleBn: 'বিজয়ী' });
    await version(p1.id);
    const list = (query: string) =>
      call<Paginated<AdminCertificateTemplateRow>>(
        env,
        'GET',
        `/admin/certificate-templates${query}`,
        admin.cookie,
      );
    // Within a type, the newest template first; the types in order.
    const all = await list('');
    expect(all.json.items.map((r) => [r.lineageId, r.versions])).toEqual([
      [p2.lineageId, 1],
      [p1.lineageId, 2],
      [w.lineageId, 1],
    ]);
    const second = await list('?page=2&pageSize=2');
    expect([second.json.total, second.json.items.map((r) => r.lineageId)]).toEqual([
      3,
      [w.lineageId],
    ]);
    const winners = await list('?type=winner');
    expect([winners.json.total, winners.json.items.map((r) => r.lineageId)]).toEqual([
      1,
      [w.lineageId],
    ]);
    for (const bad of ['?pageSize=51', '?page=0', '?type=honour', '?extra=1'])
      expect([bad, (await list(bad)).status]).toEqual([bad, 400]);
  });

  it('the database refuses changing or deleting a version, and changing a signatory or an image', async () => {
    const image = await uploaded(png(300, 100));
    const t = await create({ signatories: [signatory(image.id)] });
    await expect(
      prisma.certificateTemplate.update({ where: { id: t.id }, data: { titleEn: 'Changed' } }),
    ).rejects.toThrow(/a version never changes/);
    await expect(prisma.certificateTemplate.delete({ where: { id: t.id } })).rejects.toThrow(
      /never deleted/,
    );
    await expect(
      prisma.certificateTemplateSignatory.updateMany({
        where: { templateId: t.id },
        data: { nameEn: 'Someone else' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.certificateTemplateSignatory.deleteMany({ where: { templateId: t.id } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.certificateImage.update({ where: { id: image.id }, data: { width: 10 } }),
    ).rejects.toThrow(/never changes/);
  });

  it('refuses HTML, an unknown placeholder, a stray brace, too long after filling, four signatories, an unknown image', async () => {
    const refused: [string, Record<string, unknown>, string][] = [
      ['html', { bodyEn: 'Dear <b>{name}</b>' }, 'template_text: bodyEn'],
      ['unknown placeholder', { bodyBn: '{name} of {school}' }, 'template_text: bodyBn'],
      ['stray brace', { titleEn: 'Award {name' }, 'template_text: titleEn'],
      ['double brace', { titleBn: '{{name}}' }, 'template_text: titleBn'],
      // 501 + {name}'s budget of 100 = 601 > 600, though the text itself is 507 characters.
      ['too long', { bodyEn: `${'x'.repeat(501)}{name}` }, 'template_text: bodyEn'],
      [
        'placeholder in a signatory',
        { signatories: [{ ...signatory(), nameEn: '{name}' }] },
        'template_text: nameEn',
      ],
      ['empty title', { titleEn: '   ' }, 'template_text: titleEn'],
    ];
    for (const [what, over, message] of refused) {
      const res = await call(
        env,
        'POST',
        '/admin/certificate-templates',
        admin.cookie,
        template(over),
      );
      expect([what, res.status, details(res.json)?.some((d) => d.includes(message))]).toEqual([
        what,
        400,
        true,
      ]);
    }
    // Exactly at the budget is fine: 500 + 100.
    await create({ bodyEn: `${'x'.repeat(500)}{name}` });
    const four = await call(env, 'POST', '/admin/certificate-templates', admin.cookie, {
      ...template(),
      signatories: [1, 2, 3, 4].map((n) => signatory(null, n)),
    });
    expect(four.status).toBe(400);
    const unknownImage = await call(env, 'POST', '/admin/certificate-templates', admin.cookie, {
      ...template(),
      signatories: [signatory(randomUUID())],
    });
    expect([unknownImage.status, details(unknownImage.json)]).toEqual([400, ['image_unknown']]);
    const badType = await call(
      env,
      'POST',
      '/admin/certificate-templates',
      admin.cookie,
      template({ type: 'honour' }),
    );
    expect(badType.status).toBe(400);
    expect(await prisma.certificateTemplate.count()).toBe(1);
  });

  it('the CHECKs refuse what the DTO refuses, written past the API', async () => {
    const row = (over: Record<string, unknown>) => ({
      lineageId: randomUUID(),
      version: 1,
      type: 'participation',
      titleEn: 'T',
      titleBn: 'T',
      bodyEn: 'B {name}',
      bodyBn: 'B',
      createdById: admin.id,
      ...over,
    });
    for (const over of [
      { bodyEn: '<script>alert(1)</script>' },
      { bodyBn: 'Hello {school}' },
      { titleEn: '{name' },
      { type: 'other' },
      { titleEn: 'x'.repeat(121) },
    ])
      await expect(prisma.certificateTemplate.create({ data: row(over) })).rejects.toThrow(
        /check constraint|violates/i,
      );
    const ok = await prisma.certificateTemplate.create({ data: row({}) });
    await expect(
      prisma.certificateTemplateSignatory.create({
        data: {
          templateId: ok.id,
          position: 1,
          nameEn: 'A {name}',
          nameBn: 'A',
          titleEn: 'T',
          titleBn: 'T',
        },
      }),
    ).rejects.toThrow(/check constraint|violates/i);
  });
});

describe('signature images', () => {
  it('PNG and JPEG by their bytes (name and Content-Type ignored), metadata stripped, audited', async () => {
    // A PNG named .svg and sent as SVG: the bytes decide.
    const res = await upload(png(400, 120), 'sig.svg', 'image/svg+xml');
    expect(res.status).toBe(201);
    const info = (await res.json()) as CertificateImageInfo;
    expect(info).toMatchObject({ contentType: 'image/png', width: 400, height: 120 });
    expect(await lastAudit('certificate_images.uploaded')).toMatchObject({
      actorId: admin.id,
      entityId: info.id,
      meta: { width: 400, height: 120, byteSize: info.byteSize },
    });
    const stored = await prisma.certificateImage.findUniqueOrThrow({ where: { id: info.id } });
    expect(Buffer.from(stored.data).toString('latin1')).not.toContain('GPS');

    const j = await upload(jpeg(800, 300), 'sig.png', 'image/png');
    expect(j.status).toBe(201);
    const jInfo = (await j.json()) as CertificateImageInfo;
    expect(jInfo).toMatchObject({ contentType: 'image/jpeg', width: 800, height: 300 });
    const jStored = await prisma.certificateImage.findUniqueOrThrow({ where: { id: jInfo.id } });
    expect(Buffer.from(jStored.data).toString('latin1')).not.toContain('GPSLatitude');
  });

  it('serves an image to an admin with headers that never let it render as a document', async () => {
    const info = await uploaded(png(200, 80));
    const res = await fetch(`${env.base}/api/admin/certificate-images/${info.id}`, {
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(
      Buffer.from(await res.arrayBuffer())
        .subarray(1, 4)
        .toString('latin1'),
    ).toBe('PNG');
    const missing = await fetch(`${env.base}/api/admin/certificate-images/${randomUUID()}`, {
      headers: { cookie: admin.cookie },
    });
    expect(missing.status).toBe(404);
    const malformed = await fetch(`${env.base}/api/admin/certificate-images/not-an-id`, {
      headers: { cookie: admin.cookie },
    });
    expect(malformed.status).toBe(400);
  });

  it('refuses WebP, GIF, SVG, over the pixel caps (a bomb by its header), an unreadable header, no file; 413 above 200 KB', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(100)]);
    const truncated = Buffer.concat([
      PNG_SIG,
      be32(13),
      Buffer.from('IHDR', 'latin1'),
      Buffer.alloc(5),
    ]);
    const cases: [string, Buffer, string][] = [
      ['webp', webp(300, 100), 'unsupported_type'],
      ['gif', gif, 'unsupported_type'],
      ['svg', svg, 'unsupported_type'],
      ['too wide', png(2001, 10), 'bad_dimensions'],
      ['too tall', png(10, 1001), 'bad_dimensions'],
      ['too small', png(9, 100), 'bad_dimensions'],
      ['bomb header', png(60_000, 60_000, false), 'bad_dimensions'],
      ['jpeg too wide', jpeg(2001, 100), 'bad_dimensions'],
      ['unreadable', truncated, 'unreadable'],
      ['jpeg without a frame', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'unreadable'],
    ];
    for (const [what, bytes, problem] of cases) {
      const res = await upload(bytes, 'x.png', 'image/png');
      expect([what, res.status, details(await res.json())]).toEqual([
        what,
        400,
        ['image_rejected', problem],
      ]);
    }
    // The largest allowed sides pass.
    await uploaded(png(2000, 1000));
    const big = Buffer.concat([png(200, 80), Buffer.alloc(205_000)]);
    expect((await upload(big, 'big.png', 'image/png')).status).toBe(413);
    const none = await fetch(`${env.base}/api/admin/certificate-images`, {
      method: 'POST',
      headers: { cookie: admin.cookie, 'x-requested-with': 'XMLHttpRequest' },
      body: new FormData(),
    });
    expect([none.status, details(await none.json())]).toEqual([400, ['image_rejected', 'empty']]);
    expect(await prisma.certificateImage.count()).toBe(1);
  });
});

describe('issue-one', () => {
  const body = (email: string, over: Record<string, unknown> = {}) => ({
    email,
    type: 'participation',
    roundId: round1.id,
    reason: 'Missed the batch run (school list late)',
    ...over,
  });

  it('issues a participation certificate with the active version pinned, audited with the reason; 409 the second time', async () => {
    const t = await create();
    await activate(t.id);
    const s = await student();
    const res = await issueOne(body(`  ${s.email.toUpperCase()} `));
    expect(res.status).toBe(201);
    expect(res.json.templateVersion).toBe(1);
    expect(res.json.serial).toMatch(/^SLO-\d{4}-[0-8]\d{5}$/);
    const cert = await prisma.certificate.findUniqueOrThrow({
      where: { id: res.json.certificateId },
    });
    expect(cert).toMatchObject({
      userId: s.id,
      type: 'participation',
      roundId: round1.id,
      templateId: t.id,
      nameOnCertificate: 'Nusrat Jahan',
      serial: res.json.serial,
    });
    expect(await lastAudit('certificates.issued_one')).toMatchObject({
      actorId: admin.id,
      entityId: cert.id,
      meta: {
        type: 'participation',
        roundId: round1.id,
        userId: s.id,
        templateVersion: 1,
        reason: 'Missed the batch run (school list late)',
      },
    });
    const again = await issueOne(body(s.email));
    expect([again.status, details(again.json)]).toEqual([409, ['already_issued']]);
  });

  it('pins the ACTIVE version, not the latest; a later version never changes an issued certificate (issue-one and the batch issuer)', async () => {
    const v1 = await create();
    await activate(v1.id);
    const [a, b, c] = [await student(), await student(), await student()];
    expect((await issueOne(body(a.email))).json.templateVersion).toBe(1);
    // Version 2 exists but is not active yet: still version 1.
    const v2 = (await version(v1.id, { ...versionBody, titleEn: 'Second' })).json;
    expect((await issueOne(body(b.email))).json.templateVersion).toBe(1);
    await activate(v2.id);
    expect((await issueOne(body(c.email))).json.templateVersion).toBe(2);
    const byUser = async (userId: string) =>
      (await prisma.certificate.findFirstOrThrow({ where: { userId } })).templateId;
    expect([await byUser(a.id), await byUser(b.id), await byUser(c.id)]).toEqual([
      v1.id,
      v1.id,
      v2.id,
    ]);
    const counts = await Promise.all(
      [v1.id, v2.id].map(
        async (id) =>
          (
            await call<AdminCertificateTemplate>(
              env,
              'GET',
              `/admin/certificate-templates/${id}`,
              admin.cookie,
            )
          ).json.issuedCount,
      ),
    );
    expect(counts).toEqual([2, 1]);

    // Core's batch issuer pins the same way: the promotion template's active version at issue, with a later version
    // already there (not active), and that later version's activation changes nothing issued.
    const p1 = await create({ type: 'promotion', titleEn: 'Promotion', titleBn: 'উত্তরণ' });
    await activate(p1.id);
    const p2 = (await version(p1.id, { ...versionBody, titleEn: 'Promotion 2' })).json;
    await prisma.roundEntry.create({ data: { userId: a.id, roundId: rounds.later! } });
    const issuer = new CertificateIssuer(prisma as unknown as PrismaService);
    expect(
      await issuer.issue({ type: 'promotion', roundId: rounds.later!, requestedBy: admin.id }),
    ).toBe(1);
    await activate(p2.id);
    const promoted = await prisma.certificate.findFirstOrThrow({
      where: { userId: a.id, type: 'promotion' },
    });
    expect(promoted.templateId).toBe(p1.id);
  });

  it('carries no version when the type has no active template', async () => {
    await create(); // participation, never activated
    const s = await student();
    const res = await issueOne(body(s.email));
    expect([res.status, res.json.templateVersion]).toEqual([201, null]);
  });

  it('fits the type to the round: participation the first, promotion a later one, winner a final', async () => {
    const s = await student();
    const cases: [string, string, number][] = [
      ['participation', rounds.later!, 409],
      ['promotion', round1.id, 409],
      ['winner', round1.id, 409],
      ['winner', rounds.later!, 409],
      ['promotion', rounds.later!, 201],
      ['promotion', rounds.final!, 201],
      ['winner', rounds.final!, 201],
    ];
    for (const [type, roundId, status] of cases) {
      const res = await issueOne(body(s.email, { type, roundId }));
      expect([type, roundId, res.status, status === 409 ? details(res.json) : undefined]).toEqual([
        type,
        roundId,
        status,
        status === 409 ? ['wrong_round'] : undefined,
      ]);
    }
    expect((await issueOne(body(s.email, { roundId: randomUUID() }))).status).toBe(404);
  });

  it('only a registered, unblocked student or ambassador', async () => {
    const unregistered = await makeUser(prisma, { role: 'student' });
    const blocked = await student({ isBlocked: true });
    const staff = await makeUser(prisma, { role: 'manager' });
    const ambassador = await student({ role: 'ambassador' });
    for (const email of ['nobody@test.invalid', unregistered.email, blocked.email, staff.email]) {
      const res = await issueOne(body(email));
      expect([email, res.status, details(res.json)]).toEqual([email, 409, ['unknown_user']]);
    }
    expect((await issueOne(body(ambassador.email))).status).toBe(201);
    expect(await prisma.certificate.count()).toBe(1);
  });

  it('keeps demo and real apart; a demo account gets a demo-range serial, never the sequence', async () => {
    const demo = await student({
      email: `s-${randomUUID().slice(0, 8)}@demo.sirat.invalid`,
      demoBatchId,
    });
    const real = await student();
    const wrongSide = [
      await issueOne(body(demo.email)), // a demo account in the real Round 1
      await issueOne(body(real.email, { roundId: rounds.demo })), // a real one in a demo round
    ];
    for (const res of wrongSide)
      expect([res.status, details(res.json)]).toEqual([409, ['demo_side']]);
    const [before] = await prisma.$queryRaw<{ last_value: bigint; is_called: boolean }[]>`
      SELECT "last_value", "is_called" FROM "certificate_serial_seq"`;
    const ok = await issueOne(body(demo.email, { roundId: rounds.demo }));
    expect(ok.status).toBe(201);
    expect(ok.json.serial).toMatch(/^SLO-\d{4}-9\d{5}$/);
    const [after] = await prisma.$queryRaw<{ last_value: bigint; is_called: boolean }[]>`
      SELECT "last_value", "is_called" FROM "certificate_serial_seq"`;
    expect(after).toEqual(before);
  });

  it('validates the request (reason, email, type, round id)', async () => {
    const s = await student();
    for (const over of [
      { reason: 'no' },
      { reason: 'x'.repeat(201) },
      { email: 'not-an-email' },
      { type: 'honour' },
      { roundId: 'round-1' },
      { extra: true },
    ])
      expect([over, (await issueOne(body(s.email, over))).status]).toEqual([over, 400]);
    expect(await prisma.certificate.count()).toBe(0);
  });
});
