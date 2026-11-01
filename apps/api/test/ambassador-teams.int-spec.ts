/**
 * Ambassador teams (core C5b-3, CORE-PLAN D7; lead 2026-11-01): one team per ambassador and per student, at most 10
 * members with the owner, joined with the code in any letter case; members see first names only; members may leave
 * but not the owner; a revoked owner's team takes no new members; joins are limited per user and per IP, refusals
 * included; admins list, read and rename (audited with a reason, never the names).
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  AdminTeamDetail,
  AdminTeamRow,
  AmbassadorOverview,
  MyTeam,
  Paginated,
} from '@sirat/shared';
import type Redis from 'ioredis';
import { newPromoCode } from '../src/modules/ambassadors/promo-code';
import { REDIS_CACHE } from '../src/redis/redis.module';
import { bootCoreApp, call, sessionFor, type CoreApp } from './core-helpers';
import { makeUser, testPrisma } from './helpers';

let env: CoreApp;
let prisma: PrismaClient;
let redis: Redis;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  redis = env.app.get(REDIS_CACHE);
  admin = await sessionFor(env, prisma, { role: 'admin' });
});

/** Every request here comes from one IP: start each test with an empty per-IP join count. */
beforeEach(async () => {
  const keys = await redis.keys('teams:join:ip:*');
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

const details = (json: unknown) => (json as { details?: string[] }).details;
const teamName = () => `Team ${randomUUID().slice(0, 8)}`;

async function ambassador(name = 'Nusrat Jahan Rahman') {
  const s = await sessionFor(env, prisma, { role: 'ambassador', name });
  await prisma.ambassadorProfile.create({
    data: { userId: s.id, promoCode: newPromoCode(), approvedAt: new Date() },
  });
  return s;
}
const student = (name = 'Rahim Uddin Chowdhury') =>
  sessionFor(env, prisma, { role: 'student', name });

const createTeam = (cookie: string, name = teamName()) =>
  call<MyTeam>(env, 'POST', '/ambassador/teams', cookie, { name });
const join = (cookie: string, code: string) =>
  call<MyTeam>(env, 'POST', '/teams/join', cookie, { code });
const mine = (cookie: string) => call<MyTeam>(env, 'GET', '/teams/mine', cookie);
const leave = (cookie: string) => call(env, 'POST', '/teams/mine/leave', cookie);

describe('creating and joining', () => {
  it('an ambassador creates one team, is its first member, and alone sees its code', async () => {
    const owner = await ambassador();
    const created = await createTeam(owner.cookie);
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      memberCount: 1,
      isOwner: true,
      members: [{ firstName: 'Nusrat', isOwner: true }],
    });
    expect(created.json.joinCode).toMatch(/^TM-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(details((await createTeam(owner.cookie)).json)).toEqual(['already_has_team']);

    const other = await ambassador();
    const taken = await createTeam(other.cookie, created.json.name.toUpperCase());
    expect([taken.status, details(taken.json)]).toEqual([409, ['name_taken']]);
    expect((await createTeam(other.cookie, 'ab')).status).toBe(400);
    const stu = await student();
    expect((await createTeam(stu.cookie)).status).toBe(403);

    const me = await call<AmbassadorOverview>(env, 'GET', '/ambassador/me', owner.cookie);
    expect(me.json.team).toEqual({
      id: created.json.id,
      name: created.json.name,
      memberCount: 1,
      isOwner: true,
    });
  });

  it('students join with the code in any case, see first names only, and may leave; the owner may not', async () => {
    const owner = await ambassador();
    const { json: team } = await createTeam(owner.cookie);
    const s1 = await student();
    const joined = await join(s1.cookie, ` ${team.joinCode!.toLowerCase()} `);
    expect(joined.status).toBe(200);
    expect(joined.json).toMatchObject({
      id: team.id,
      isOwner: false,
      joinCode: null,
      memberCount: 2,
    });
    expect(joined.json.members).toEqual([
      { firstName: 'Nusrat', isOwner: true },
      { firstName: 'Rahim', isOwner: false },
    ]);
    for (const needle of ['Jahan', 'Chowdhury', '@', 'institution', 'email', 'phone'])
      expect([needle, joined.text.includes(needle)]).toEqual([needle, false]);
    expect((await mine(s1.cookie)).json.id).toBe(team.id);

    const elsewhere = await ambassador();
    const { json: other } = await createTeam(elsewhere.cookie);
    expect(details((await join(s1.cookie, other.joinCode!)).json)).toEqual(['already_in_team']);
    expect(details((await join(owner.cookie, other.joinCode!)).json)).toEqual(['already_in_team']);

    expect((await leave(s1.cookie)).status).toBe(204);
    expect((await mine(s1.cookie)).status).toBe(404);
    expect(details((await leave(s1.cookie)).json)).toEqual(['not_in_team']);
    expect(details((await leave(owner.cookie)).json)).toEqual(['owner_cannot_leave']);
    expect((await join(s1.cookie, other.joinCode!)).status).toBe(200); // free to join another team

    expect((await join(s1.cookie, 'TM-ZZZZZZ')).status).toBe(404);
    expect((await join(s1.cookie, 'not a code')).status).toBe(400);
    const audits = await prisma.auditLog.findMany({
      where: { entityId: team.id, entityType: 'team' },
    });
    expect(audits.map((a) => a.action).sort()).toEqual([
      'team.created',
      'team.joined',
      'team.left',
    ]);
  });

  it('holds at most 10 members, the owner included, even when 12 join at once', async () => {
    const owner = await ambassador();
    const { json: team } = await createTeam(owner.cookie);
    const students = await Promise.all(Array.from({ length: 12 }, () => student()));
    const first = await Promise.all(students.map((s) => join(s.cookie, team.joinCode!)));
    // Every status, so a failure says what happened. Twelve users with one join each from an IP whose count
    // beforeEach cleared meet no limit (no 429). Under load a join can wait on the team's row lock past the
    // transaction timeout and get 503 SERVICE_BUSY (designed: the client retries), so those try once more, as a
    // client after Retry-After would: the cap must still hold exactly.
    const seen = first.map((a) => a.status);
    expect({ seen, unexpected: seen.filter((s) => ![200, 409, 503].includes(s)) }).toEqual({
      seen,
      unexpected: [],
    });
    const answers = await Promise.all(
      first.map((a, i) => (a.status === 503 ? join(students[i]!.cookie, team.joinCode!) : a)),
    );
    const statuses = answers.map((a) => a.status);
    expect({ seen, statuses: statuses.filter((s) => s === 200).length }).toEqual({
      seen,
      statuses: 9,
    });
    expect(answers.filter((a) => a.status === 409).map((a) => details(a.json))).toEqual([
      ['team_full'],
      ['team_full'],
      ['team_full'],
    ]);
    expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(10);
  });

  it('a team whose owner is no longer an ambassador takes no new members; its members keep it', async () => {
    const owner = await ambassador();
    const { json: team } = await createTeam(owner.cookie);
    const kept = await student();
    await join(kept.cookie, team.joinCode!);
    await prisma.ambassadorProfile.update({
      where: { userId: owner.id },
      data: { approvedAt: null },
    });
    await prisma.user.update({ where: { id: owner.id }, data: { role: 'student' } });
    const late = await student();
    const res = await join(late.cookie, team.joinCode!);
    expect([res.status, details(res.json)]).toEqual([409, ['team_closed']]);
    expect((await mine(kept.cookie)).json.id).toBe(team.id);
    const row = await call<AdminTeamDetail>(env, 'GET', `/admin/teams/${team.id}`, admin.cookie);
    expect(row.json.open).toBe(false);
  });
});

describe('join limits', () => {
  it('counts every attempt per user, refusals included', async () => {
    const s = await student();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await join(s.cookie, 'TM-ZZZZZZ')).status);
    expect(statuses.slice(0, 10).every((x) => x === 404)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('counts every attempt per IP, so many accounts behind one IP cannot guess quickly', async () => {
    const first = await student();
    expect((await join(first.cookie, 'TM-ZZZZZZ')).status).toBe(404);
    const [key] = await redis.keys('teams:join:ip:*');
    expect(key).toBeDefined();
    expect(await redis.get(key!)).toBe('1');
    await redis.set(key!, '60', 'PX', 60_000); // as if 60 attempts came from this IP in the window
    const next = await student();
    expect((await join(next.cookie, 'TM-ZZZZZZ')).status).toBe(429);
  });
});

describe('admin', () => {
  it('lists, reads with the members, and renames with a reason; the audit row keeps no names', async () => {
    const owner = await ambassador();
    const { json: team } = await createTeam(owner.cookie);
    const s = await student();
    await join(s.cookie, team.joinCode!);
    const list = await call<Paginated<AdminTeamRow>>(
      env,
      'GET',
      `/admin/teams?q=${encodeURIComponent(team.name)}`,
      admin.cookie,
    );
    expect(list.json.items).toEqual([
      expect.objectContaining({
        id: team.id,
        open: true,
        memberCount: 2,
        owner: { userId: owner.id, name: 'Nusrat Jahan Rahman' },
      }),
    ]);
    const detail = await call<AdminTeamDetail>(env, 'GET', `/admin/teams/${team.id}`, admin.cookie);
    expect(detail.json.members.map((m) => m.userId)).toEqual([owner.id, s.id]);
    expect(detail.json.members[1]!.email).toMatch(/@/);

    const newName = teamName();
    const rename = (body: unknown) =>
      call<AdminTeamRow>(env, 'PATCH', `/admin/teams/${team.id}`, admin.cookie, body);
    const ok = await rename({
      name: newName,
      reason: 'Offensive name',
      expectedUpdatedAt: detail.json.updatedAt,
    });
    expect([ok.status, ok.json.name]).toEqual([200, newName]);
    const stale = await rename({
      name: teamName(),
      reason: 'Again',
      expectedUpdatedAt: detail.json.updatedAt,
    });
    expect(details(stale.json)).toEqual(['stale']);
    const same = await rename({
      name: newName,
      reason: 'Same',
      expectedUpdatedAt: ok.json.updatedAt,
    });
    expect(details(same.json)).toEqual(['nothing_to_update']);
    const other = await ambassador();
    const { json: otherTeam } = await createTeam(other.cookie);
    const taken = await rename({
      name: otherTeam.name,
      reason: 'Clash',
      expectedUpdatedAt: ok.json.updatedAt,
    });
    expect(details(taken.json)).toEqual(['name_taken']);
    expect(
      (await rename({ name: teamName(), reason: 'ab', expectedUpdatedAt: ok.json.updatedAt }))
        .status,
    ).toBe(400);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: team.id, action: 'team.renamed' },
    });
    expect(audit?.meta).toEqual({ reason: 'Offensive name' });
    expect((await mine(s.cookie)).json.name).toBe(newName);
  });

  it('is for admins only: manager, ambassador and student get 403', async () => {
    for (const role of ['manager', 'ambassador', 'student'] as const) {
      const other = await sessionFor(env, prisma, { role });
      expect((await call(env, 'GET', '/admin/teams', other.cookie)).status).toBe(403);
      expect((await call(env, 'GET', `/admin/teams/${randomUUID()}`, other.cookie)).status).toBe(
        403,
      );
    }
    const staff = await sessionFor(env, prisma, { role: 'manager' });
    expect((await mine(staff.cookie)).status).toBe(403);
  });
});

describe('database rules', () => {
  it('refuses a short name, a malformed code, a second team per owner and a second team per student', async () => {
    const owner = await makeUser(prisma, { role: 'ambassador' });
    const bad = (fn: () => Promise<unknown>, what: string) =>
      expect(fn()).rejects.toMatchObject({ message: expect.stringContaining(what) });
    await bad(
      () => prisma.team.create({ data: { name: 'ab', joinCode: 'TM-ABCDEF', ownerId: owner.id } }),
      'teams_name_check',
    );
    await bad(
      () => prisma.team.create({ data: { name: teamName(), joinCode: 'XX-1', ownerId: owner.id } }),
      'teams_join_code_format_check',
    );
    const t = await prisma.team.create({
      data: { name: teamName(), joinCode: newCode(), ownerId: owner.id },
    });
    await bad(
      () =>
        prisma.team.create({ data: { name: teamName(), joinCode: newCode(), ownerId: owner.id } }),
      'Unique',
    );
    const other = await makeUser(prisma, { role: 'ambassador' });
    const t2 = await prisma.team.create({
      data: { name: teamName(), joinCode: newCode(), ownerId: other.id },
    });
    const s = await makeUser(prisma, { role: 'student' });
    await prisma.teamMember.create({ data: { teamId: t.id, userId: s.id } });
    await bad(() => prisma.teamMember.create({ data: { teamId: t2.id, userId: s.id } }), 'Unique');
  });
});

/** A valid join code for direct inserts (the API makes its own). */
function newCode(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return `TM-${Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * 32)]).join('')}`;
}
