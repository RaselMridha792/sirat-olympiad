/**
 * The ambassador leaderboard (core A4; 06-API "Ambassadors"; the lead's approval of 2026-11-10): approved, unblocked
 * ambassadors of the caller's side ranked by their points (equal points share a rank), the name, institution, points
 * and tier only, the caller's own place even off the page; cached for a minute, dropped by core's own writes;
 * ambassadors only. Also the admin list's `sort=points`, and the owner decision of 2026-11-10 that only registered
 * students become ambassadors.
 *
 * Other suites leave ambassadors in the shared test database, so this suite's ambassadors hold points in the
 * millions (always the top of the real ranking), and each test revokes its own afterwards, so a rerun starts clean.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { AdminAmbassadorRow, AmbassadorLeaderboard, Paginated } from '@sirat/shared';
import type Redis from 'ioredis';
import { LEADERBOARD_KEY } from '../src/modules/ambassadors/ambassador-leaderboard.service';
import { newPromoCode } from '../src/modules/ambassadors/promo-code';
import { REDIS_CACHE } from '../src/redis/redis.module';
import {
  bootCoreApp,
  call,
  marker,
  registeredStudent,
  sessionFor,
  type CoreApp,
} from './core-helpers';
import { applyReferenceData, testPrisma } from './helpers';

const DOMAIN = '@demo.sirat.invalid';

let env: CoreApp;
let prisma: PrismaClient;
let redis: Redis;
let admin: { id: string; cookie: string };
let batchId: string | null = null;
/** This test's ambassadors: revoked after it, so they never rank in a later test or run. */
const made: string[] = [];

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  redis = env.app.get(REDIS_CACHE);
  // Other suites may have emptied the reference tables (truncateAll); tiers come from rank_thresholds.
  if ((await prisma.rankThreshold.count()) === 0) await applyReferenceData(prisma);
  admin = await sessionFor(env, prisma, { role: 'admin' });
}, 60_000);

beforeEach(() => dropCache());

afterEach(async () => {
  await prisma.ambassadorProfile.updateMany({
    where: { userId: { in: made } },
    data: { approvedAt: null },
  });
  await prisma.user.updateMany({
    where: { id: { in: made }, role: 'ambassador' },
    data: { role: 'student' },
  });
  made.length = 0;
});

afterAll(async () => {
  if (prisma && batchId) {
    // This suite's demo accounts go the one way demo rows go (demo_clear), registered first.
    const users = await prisma.user.findMany({
      where: { demoBatchId: batchId },
      select: { id: true },
    });
    await prisma.demoRecord.createMany({
      data: users.map((u) => ({ batchId: batchId!, tableName: 'users', rowId: u.id })),
      skipDuplicates: true,
    });
    await prisma.$queryRaw`SELECT demo_clear(${batchId}::uuid)`;
  }
  await dropCache();
  await env?.app.close();
  await prisma?.$disconnect();
});

const dropCache = () => redis?.del(`${LEADERBOARD_KEY}:real`, `${LEADERBOARD_KEY}:demo`);
const details = (json: unknown) => (json as { details?: string[] }).details;
const board = (cookie: string, query = '') =>
  call<AmbassadorLeaderboard>(env, 'GET', `/ambassador/leaderboard${query}`, cookie);

/** A signed-in approved ambassador with `points` in the ledger (one row). */
async function ambassador(
  name: string,
  points: number,
  extra: { demo?: boolean; blocked?: boolean; revoked?: boolean } = {},
) {
  if (extra.demo && !batchId)
    batchId = (
      await prisma.demoBatch.create({ data: { status: 'loaded', reason: 'Leaderboard test' } })
    ).id;
  const s = await sessionFor(env, prisma, {
    role: extra.revoked ? 'student' : 'ambassador',
    name,
    institution: `${name} School`,
    isBlocked: Boolean(extra.blocked),
    ...(extra.demo
      ? { email: `amb-${randomUUID().slice(0, 8)}${DOMAIN}`, demoBatchId: batchId }
      : {}),
  });
  made.push(s.id);
  await prisma.ambassadorProfile.create({
    data: {
      userId: s.id,
      promoCode: newPromoCode(),
      approvedAt: extra.revoked ? null : new Date(),
    },
  });
  if (points)
    await prisma.pointLedger.create({
      data: { userId: s.id, eventKey: `test:${randomUUID()}`, amount: points, reason: 'test' },
    });
  return s;
}

describe('the ranking', () => {
  it("ranks the approved ambassadors of the caller's side by points; equal points share a rank; no id or contact", async () => {
    const mk = marker();
    const a = await ambassador(`${mk} Anika`, 3_000_000);
    const b = await ambassador(`${mk} Bashir`, 2_000_000);
    const c = await ambassador(`${mk} Chumki`, 2_000_000);
    const d = await ambassador(`${mk} Dipu`, 1_000_000);
    // Never ranked: revoked, blocked, or the other side.
    await ambassador(`${mk} Revoked`, 9_000_000, { revoked: true });
    await ambassador(`${mk} Blocked`, 8_000_000, { blocked: true });
    await ambassador(`${mk} Demo`, 7_000_000, { demo: true });

    const res = await board(a.cookie);
    expect(res.status).toBe(200);
    expect(res.json.items.slice(0, 4).map((r) => [r.rank, r.name, r.points, r.isMe])).toEqual([
      [1, `${mk} Anika`, 3_000_000, true],
      [2, `${mk} Bashir`, 2_000_000, false],
      [2, `${mk} Chumki`, 2_000_000, false],
      [4, `${mk} Dipu`, 1_000_000, false],
    ]);
    expect(res.json.items.some((r) => /Revoked|Blocked|Demo$/.test(r.name))).toBe(false);
    expect(Object.keys(res.json.items[0]!).sort()).toEqual(
      ['institution', 'isMe', 'name', 'points', 'rank', 'tier'].sort(),
    );
    // The tier is the highest threshold the points reach (thresholds are data; another suite may have changed them).
    const thresholds = await prisma.rankThreshold.findMany({ orderBy: { minPoints: 'asc' } });
    const tier = thresholds.filter((t) => t.minPoints <= 3_000_000).at(-1)?.name ?? null;
    expect(res.json.items[0]).toMatchObject({ institution: `${mk} Anika School`, tier });
    expect(res.json.me).toEqual({ rank: 1, points: 3_000_000 });
    expect(res.text).not.toMatch(/@|SR-|userId|[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(new Date(res.json.asOf).getTime()).toBeLessThanOrEqual(Date.now());

    // The caller's own place even when it is not on the page.
    const off = await board(d.cookie, '?page=1&pageSize=2');
    expect(off.json.items.map((r) => r.name)).toEqual([`${mk} Anika`, expect.any(String)]);
    expect(off.json.items.every((r) => !r.isMe)).toBe(true);
    expect(off.json.me).toEqual({ rank: 4, points: 1_000_000 });
    expect(off.json.total).toBeGreaterThanOrEqual(4);
    const second = await board(b.cookie, '?page=2&pageSize=2');
    expect(second.json.items.map((r) => [r.rank, r.isMe])).toEqual([
      [2, false],
      [4, false],
    ]);
    void c;
  });

  it('keeps the demo ranking apart: a demo ambassador sees demo ambassadors only', async () => {
    const mk = marker();
    const demo = await ambassador(`${mk} DemoOne`, 50, { demo: true });
    await ambassador(`${mk} RealOne`, 60);
    const res = await board(demo.cookie);
    expect(res.status).toBe(200);
    expect(res.json.items.map((r) => r.name)).toContain(`${mk} DemoOne`);
    expect(res.json.items.map((r) => r.name)).not.toContain(`${mk} RealOne`);
    const rows = await prisma.user.findMany({
      where: { name: { in: res.json.items.map((r) => r.name) } },
      select: { demoBatchId: true },
    });
    expect(rows.every((u) => u.demoBatchId !== null)).toBe(true);
  });
});

describe('the cache', () => {
  it("holds the ranking for a minute, and core's own writes drop it at once", async () => {
    const mk = marker();
    const a = await ambassador(`${mk} First`, 5_000_000);
    const b = await ambassador(`${mk} Second`, 4_000_000);
    expect((await board(a.cookie)).json.items[0]!.name).toBe(`${mk} First`);
    // A row written behind the service's back stays unseen while the ranking is cached...
    await prisma.pointLedger.create({
      data: { userId: b.id, eventKey: `test:${randomUUID()}`, amount: 2_000_000, reason: 'test' },
    });
    expect((await board(a.cookie)).json.items[0]!.name).toBe(`${mk} First`);
    expect(await redis.ttl(`${LEADERBOARD_KEY}:real`)).toBeGreaterThan(0);
    // ...and an admin's adjustment drops it: both changes show now.
    const adjust = await call(env, 'POST', '/admin/points/adjust', admin.cookie, {
      userId: a.id,
      amount: 1,
      reason: 'Leaderboard cache test',
    });
    expect(adjust.status).toBe(200);
    const after = await board(a.cookie);
    expect(after.json.items.slice(0, 2).map((r) => [r.name, r.points])).toEqual([
      [`${mk} Second`, 6_000_000],
      [`${mk} First`, 5_000_001],
    ]);

    // A revocation drops it too: the revoked ambassador leaves the ranking at once.
    const revoke = await call(env, 'POST', `/admin/ambassadors/${b.id}/revoke`, admin.cookie, {
      reason: 'left the programme',
    });
    expect(revoke.status).toBe(200);
    const left = await board(a.cookie);
    expect(left.json.items[0]!.name).toBe(`${mk} First`);
    expect(left.json.items.map((r) => r.name)).not.toContain(`${mk} Second`);
  });
});

describe('access', () => {
  it('is for ambassadors only: no session, a student, an admin, a revoked or a blocked ambassador are refused', async () => {
    expect((await board('')).status).toBe(401);
    const student = await sessionFor(env, prisma, { role: 'student' });
    expect((await board(student.cookie)).status).toBe(403);
    expect((await board(admin.cookie)).status).toBe(403);
    // Tokens minted while they were ambassadors: the service re-reads the account.
    const revoked = await ambassador(`${marker()} Gone`, 10);
    await prisma.user.update({ where: { id: revoked.id }, data: { role: 'student' } });
    expect((await board(revoked.cookie)).status).toBe(403);
    const blocked = await ambassador(`${marker()} Stopped`, 10);
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    expect([401, 403]).toContain((await board(blocked.cookie)).status);
  });

  it('validates the paging: pageSize 1 to 50, page from 1, nothing else', async () => {
    const a = await ambassador(`${marker()} Pager`, 10);
    for (const q of ['?pageSize=51', '?pageSize=0', '?page=0', '?sort=points'])
      expect((await board(a.cookie, q)).status).toBe(400);
  });
});

describe('the admin list by points', () => {
  it('sorts by points (ties newest first) with sort=points, newest first by default, and refuses another sort', async () => {
    const mk = marker();
    const low = await ambassador(`${mk} Low`, 10);
    const high = await ambassador(`${mk} High`, 30);
    const mid = await ambassador(`${mk} Mid`, 20);
    const list = (query: string) =>
      call<Paginated<AdminAmbassadorRow>>(
        env,
        'GET',
        `/admin/ambassadors?q=${encodeURIComponent(mk)}${query}`,
        admin.cookie,
      );
    const byPoints = await list('&sort=points');
    expect(byPoints.status).toBe(200);
    expect(byPoints.json.items.map((r) => [r.userId, r.points])).toEqual([
      [high.id, 30],
      [mid.id, 20],
      [low.id, 10],
    ]);
    expect(byPoints.json.total).toBe(3);
    const paged = await list('&sort=points&page=2&pageSize=2');
    expect(paged.json.items.map((r) => r.userId)).toEqual([low.id]);
    const newest = await list('');
    expect(newest.json.items.map((r) => r.userId)).toEqual([mid.id, high.id, low.id]);
    expect((await list('&sort=rank')).status).toBe(400);
  });
});

describe('who can become an ambassador (owner decision, 2026-11-10)', () => {
  it('only a registered (paid) student: an unregistered one is refused with not_paid_student', async () => {
    const unpaid = await sessionFor(env, prisma, { role: 'student' });
    const refused = await call(
      env,
      'POST',
      `/admin/ambassadors/${unpaid.id}/approve`,
      admin.cookie,
      {
        reason: 'leads the school club',
      },
    );
    expect(refused.status).toBe(409);
    expect(details(refused.json)).toEqual(['not_paid_student']);
    expect(await prisma.ambassadorProfile.count({ where: { userId: unpaid.id } })).toBe(0);
    const { user } = await registeredStudent(prisma);
    const ok = await call(env, 'POST', `/admin/ambassadors/${user.id}/approve`, admin.cookie, {
      reason: 'leads the school club',
    });
    expect(ok.status).toBe(200);
  });
});
