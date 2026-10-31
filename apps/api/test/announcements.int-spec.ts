/**
 * Announcements over HTTP (06-API "Announcements"; docs/plans/CORE-PLAN.md section 5): what students see (live,
 * everyone or their category, newest first), the admin's create/edit/archive/restore with optimistic concurrency and
 * the audit rows, the cache that shows a write at once, and the roles. Real AppModule against the *_test database.
 * Each test tags its titles with its own marker and reads only those, so rows of other tests never count.
 */
import type { PrismaClient } from '@prisma/client';
import type { AdminAnnouncement, AnnouncementItem, ApiError, Paginated } from '@sirat/shared';
import { bootCoreApp, call, marker, sessionFor, type CoreApp } from './core-helpers';
import { testPrisma } from './helpers';

let env: CoreApp;
let prisma: PrismaClient;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  admin = await sessionFor(env, prisma, { role: 'admin', name: 'C4 Admin' });
}, 60_000);

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

type Item = AdminAnnouncement & ApiError;
const create = (body: Record<string, unknown>, cookie = admin.cookie) =>
  call<Item>(env, 'POST', '/admin/announcements', cookie, { category: null, ...body });
const studentList = async (cookie: string, mk: string) => {
  const res = await call<Paginated<AnnouncementItem>>(
    env,
    'GET',
    '/announcements?pageSize=50',
    cookie,
  );
  expect(res.status).toBe(200);
  return res.json.items.filter((a) => a.title.includes(mk)).map((a) => a.title);
};

describe('what students see', () => {
  it('only live announcements for everyone or their own category, newest first', async () => {
    const mk = marker();
    const activist = await sessionFor(env, prisma, { role: 'student', category: 'activist' });
    const achiever = await sessionFor(env, prisma, { role: 'ambassador', category: 'achiever' });
    expect((await create({ title: `${mk} everyone`, body: 'For all' })).status).toBe(201);
    expect(
      (await create({ title: `${mk} activists`, body: 'A', category: 'activist' })).status,
    ).toBe(201);
    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduled = await create({ title: `${mk} later`, body: 'Soon', publishAt: later });
    expect(scheduled.json.status).toBe('scheduled');
    const gone = await create({ title: `${mk} gone`, body: 'Old' });
    expect(
      (
        await call(env, 'POST', `/admin/announcements/${gone.json.id}/archive`, admin.cookie, {
          expectedUpdatedAt: gone.json.updatedAt,
        })
      ).status,
    ).toBe(200);

    expect(await studentList(activist.cookie, mk)).toEqual([`${mk} activists`, `${mk} everyone`]);
    expect(await studentList(achiever.cookie, mk)).toEqual([`${mk} everyone`]);
    const body = (await call(env, 'GET', '/announcements', activist.cookie)).text;
    expect(body).not.toMatch(/createdBy|created_by|authorName|archivedAt/);
  });

  it('pages on the server and refuses bad parameters', async () => {
    const s = await sessionFor(env, prisma, { role: 'student' });
    const res = await call<Paginated<AnnouncementItem>>(
      env,
      'GET',
      '/announcements?page=1&pageSize=2',
      s.cookie,
    );
    expect(res.json).toMatchObject({ page: 1, pageSize: 2 });
    expect(res.json.items.length).toBeLessThanOrEqual(2);
    for (const q of ['?pageSize=51', '?page=0', '?category=activist'])
      expect((await call(env, 'GET', `/announcements${q}`, s.cookie)).status).toBe(400);
  });

  it("shows an admin's change at once, though the pages are cached", async () => {
    const mk = marker();
    const s = await sessionFor(env, prisma, { role: 'student', category: 'activist' });
    expect(await studentList(s.cookie, mk)).toEqual([]); // fills the cache
    const made = await create({ title: `${mk} fresh`, body: 'New' });
    expect(await studentList(s.cookie, mk)).toEqual([`${mk} fresh`]);
    await call(env, 'PATCH', `/admin/announcements/${made.json.id}`, admin.cookie, {
      expectedUpdatedAt: made.json.updatedAt,
      title: `${mk} renamed`,
    });
    expect(await studentList(s.cookie, mk)).toEqual([`${mk} renamed`]);
  });

  it('is for students and ambassadors; staff and a blocked student get 403', async () => {
    for (const role of ['admin', 'manager', 'jury'] as const) {
      const staff = await sessionFor(env, prisma, { role });
      expect((await call(env, 'GET', '/announcements', staff.cookie)).status).toBe(403);
    }
    const s = await sessionFor(env, prisma, { role: 'student' });
    await prisma.user.update({ where: { id: s.id }, data: { isBlocked: true } });
    const res = await call<ApiError>(env, 'GET', '/announcements', s.cookie);
    expect(res.status).toBe(403);
    expect(res.json.details).toEqual(['account_blocked']);
  });
});

describe('admin writes', () => {
  it('creates with an audit row in the same transaction, text kept as typed', async () => {
    const mk = marker();
    const res = await create({
      title: `  ${mk}   notice  `,
      body: '  Line one\nLine <script>two</script>  ',
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      title: `${mk} notice`,
      body: 'Line one\nLine <script>two</script>',
      category: null,
      status: 'published',
      authorName: 'C4 Admin',
      archivedAt: null,
    });
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'announcement.created', entityId: res.json.id },
    });
    expect(audit).toMatchObject({ actorId: admin.id });
    expect(audit?.meta).toMatchObject({ title: `${mk} notice`, category: null });
  });

  it('refuses bad input, unknown fields and back-dating', async () => {
    const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    for (const body of [
      { title: 'ab', body: 'x' },
      { title: 'x'.repeat(151), body: 'x' },
      { title: 'Fine title', body: '' },
      { title: 'Fine title', body: 'x'.repeat(5001) },
      { title: 'Fine title', body: 'x', category: 'sdg' },
      { title: 'Fine title', body: 'x', publishAt: 'tomorrow' },
      { title: 'Fine title', body: 'x', createdById: admin.id },
      { title: 'Fine title', body: 'x', archivedAt: null },
    ])
      expect((await create(body)).status).toBe(400);
    const noCategory = await call(env, 'POST', '/admin/announcements', admin.cookie, {
      title: 'Fine title',
      body: 'x',
    });
    expect(noCategory.status).toBe(400); // null for everyone must be said
    const backdated = await create({ title: 'Fine title', body: 'x', publishAt: past });
    expect(backdated.status).toBe(400);
    expect(backdated.json.details).toEqual(['publish_in_past']);
  });

  it('edits only the version the form showed, and audits the changed fields', async () => {
    const made = await create({ title: `${marker()} v1`, body: 'Body' });
    const stale = await call<Item>(
      env,
      'PATCH',
      `/admin/announcements/${made.json.id}`,
      admin.cookie,
      {
        expectedUpdatedAt: new Date(Date.parse(made.json.updatedAt) - 1000).toISOString(),
        title: 'Lost edit',
      },
    );
    expect(stale.status).toBe(409);
    expect(stale.json.details).toEqual(['stale']);
    const same = await call<Item>(
      env,
      'PATCH',
      `/admin/announcements/${made.json.id}`,
      admin.cookie,
      {
        expectedUpdatedAt: made.json.updatedAt,
        title: made.json.title,
      },
    );
    expect(same.json.details).toEqual(['nothing_to_update']);
    const ok = await call<Item>(
      env,
      'PATCH',
      `/admin/announcements/${made.json.id}`,
      admin.cookie,
      {
        expectedUpdatedAt: made.json.updatedAt,
        body: 'New body',
        category: 'achiever',
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ body: 'New body', category: 'achiever' });
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'announcement.updated', entityId: made.json.id },
    });
    expect((audit?.meta as { fields: string[] }).fields.sort()).toEqual(['body', 'category']);
  });

  it('archives and restores, never deletes; an archived one is not edited', async () => {
    const made = await create({ title: `${marker()} arch`, body: 'Body' });
    const archived = await call<Item>(
      env,
      'POST',
      `/admin/announcements/${made.json.id}/archive`,
      admin.cookie,
      {
        expectedUpdatedAt: made.json.updatedAt,
      },
    );
    expect(archived.json).toMatchObject({ status: 'archived' });
    const again = await call<Item>(
      env,
      'POST',
      `/admin/announcements/${made.json.id}/archive`,
      admin.cookie,
      {
        expectedUpdatedAt: archived.json.updatedAt,
      },
    );
    expect(again.json.details).toEqual(['archived']);
    const edit = await call<Item>(
      env,
      'PATCH',
      `/admin/announcements/${made.json.id}`,
      admin.cookie,
      {
        expectedUpdatedAt: archived.json.updatedAt,
        title: 'Edited after archive',
      },
    );
    expect(edit.json.details).toEqual(['archived']);
    const restored = await call<Item>(
      env,
      'POST',
      `/admin/announcements/${made.json.id}/restore`,
      admin.cookie,
      {
        expectedUpdatedAt: archived.json.updatedAt,
      },
    );
    expect(restored.json).toMatchObject({ status: 'published', archivedAt: null });
    const notArchived = await call<Item>(
      env,
      'POST',
      `/admin/announcements/${made.json.id}/restore`,
      admin.cookie,
      {
        expectedUpdatedAt: restored.json.updatedAt,
      },
    );
    expect(notArchived.json.details).toEqual(['not_archived']);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: made.json.id,
          action: { in: ['announcement.archived', 'announcement.restored'] },
        },
      }),
    ).toBe(2);
    expect(await prisma.announcement.count({ where: { id: made.json.id } })).toBe(1);
  });

  it('lists every status for admins and filters by status', async () => {
    const mk = marker();
    await create({ title: `${mk} now`, body: 'x' });
    await create({
      title: `${mk} later`,
      body: 'x',
      publishAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const titles = async (q: string) =>
      (
        await call<Paginated<AdminAnnouncement>>(
          env,
          'GET',
          `/admin/announcements?pageSize=50${q}`,
          admin.cookie,
        )
      ).json.items
        .filter((a) => a.title.includes(mk))
        .map((a) => `${a.title}:${a.status}`);
    expect((await titles('')).sort()).toEqual([`${mk} later:scheduled`, `${mk} now:published`]);
    expect(await titles('&status=scheduled')).toEqual([`${mk} later:scheduled`]);
    expect(await titles('&status=archived')).toEqual([]);
  });

  it('is for admins only: students, managers and a demoted admin get 403', async () => {
    const made = await create({ title: `${marker()} roles`, body: 'x' });
    for (const role of ['student', 'ambassador', 'manager', 'jury'] as const) {
      const other = await sessionFor(env, prisma, { role });
      expect((await call(env, 'GET', '/admin/announcements', other.cookie)).status).toBe(403);
      expect((await create({ title: 'Nope nope', body: 'x' }, other.cookie)).status).toBe(403);
    }
    const demoted = await sessionFor(env, prisma, { role: 'admin' });
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'student' } });
    expect((await create({ title: 'Nope nope', body: 'x' }, demoted.cookie)).status).toBe(403);
    expect(
      (
        await call(env, 'PATCH', `/admin/announcements/${made.json.id}`, demoted.cookie, {
          expectedUpdatedAt: made.json.updatedAt,
          title: 'Taken over',
        })
      ).status,
    ).toBe(403);
  });
});

describe('database rules', () => {
  it('refuses out-of-range text and an archive time before creation, even outside the API', async () => {
    const base = { body: 'x', createdById: admin.id };
    await expect(prisma.announcement.create({ data: { ...base, title: 'ab' } })).rejects.toThrow();
    await expect(
      prisma.announcement.create({ data: { ...base, title: 'Long enough', body: '' } }),
    ).rejects.toThrow();
    await expect(
      prisma.announcement.create({
        data: { ...base, title: 'Long enough', archivedAt: new Date('2000-01-01T00:00:00Z') },
      }),
    ).rejects.toThrow();
    const [index] = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'announcements_live_published_idx'`;
    expect(index?.indexdef).toMatch(/WHERE \(archived_at IS NULL\)/);
  });
});
