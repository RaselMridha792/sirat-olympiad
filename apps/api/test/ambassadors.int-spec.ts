/**
 * Ambassadors over HTTP (06-API "Ambassadors"; docs/plans/CORE-PLAN.md section 6, C5a, owner Q2 default): an admin
 * approves a paid student, the server assigns the code, payments' registration accepts that code exactly while it
 * is approved, revoking keeps the row and the referrals; the ambassador's own panel; the database rules. Real
 * AppModule against the *_test database.
 */
import type { PrismaClient } from '@prisma/client';
import type {
  AdminAmbassadorRow,
  AmbassadorOverview,
  AmbassadorState,
  ApiError,
  Paginated,
} from '@sirat/shared';
import { RegistrationService } from '../src/modules/payments/registration/registration.service';
import {
  bootCoreApp,
  call,
  marker,
  registeredStudent,
  sessionFor,
  type CoreApp,
} from './core-helpers';
import { applyReferenceData, makeUser, testPhone, testPrisma } from './helpers';

let env: CoreApp;
let prisma: PrismaClient;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  // Other suites may have emptied the reference tables (truncateAll); ranks come from rank_thresholds.
  if ((await prisma.rankThreshold.count()) === 0) await applyReferenceData(prisma);
  admin = await sessionFor(env, prisma, { role: 'admin' });
}, 60_000);

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

type Answer = AmbassadorState & ApiError;
const approve = (userId: string, cookie = admin.cookie, reason = 'leads the school club') =>
  call<Answer>(env, 'POST', `/admin/ambassadors/${userId}/approve`, cookie, { reason });
const revoke = (userId: string, cookie = admin.cookie, reason = 'left the programme') =>
  call<Answer>(env, 'POST', `/admin/ambassadors/${userId}/revoke`, cookie, { reason });

/** Payments' own check, as POST /registrations/start runs it: the referrer's user id, or PROMO_INVALID. */
const referrer = (code: string) =>
  (
    env.app.get(RegistrationService) as unknown as { referrer(c: string): Promise<string> }
  ).referrer(code);

describe('approve and revoke', () => {
  it('makes a paid student an ambassador with a server code payments accepts, in one audited transaction', async () => {
    const { user } = await registeredStudent(prisma);
    const res = await approve(user.id);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ userId: user.id, role: 'ambassador' });
    expect(res.json.promoCode).toMatch(/^SR-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))!.role).toBe('ambassador');
    const audit = await prisma.auditLog.findMany({
      where: { action: 'ambassador.approved', entityId: user.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.meta).toMatchObject({ promoCode: res.json.promoCode, reapproved: false });
    // Payments' registration takes it in any case, and links the student to this ambassador.
    expect(await referrer(res.json.promoCode)).toBe(user.id);
    expect(await referrer(res.json.promoCode.toLowerCase())).toBe(user.id);
  });

  it('is idempotent: a second approval changes nothing and writes no second audit row', async () => {
    const { user } = await registeredStudent(prisma);
    const first = await approve(user.id);
    const again = await approve(user.id);
    expect(again.status).toBe(200);
    expect(again.json.promoCode).toBe(first.json.promoCode);
    expect(
      await prisma.auditLog.count({ where: { action: 'ambassador.approved', entityId: user.id } }),
    ).toBe(1);
  });

  it('revokes: the code stops working for new registrations, the row, the code and the referrals stay', async () => {
    const { user } = await registeredStudent(prisma);
    const { promoCode } = (await approve(user.id)).json;
    const referred = await registeredStudent(prisma, { referredById: user.id });
    const res = await revoke(user.id);
    expect(res.json).toMatchObject({ approvedAt: null, role: 'student', promoCode });
    await expect(referrer(promoCode)).rejects.toMatchObject({
      response: { code: 'PROMO_INVALID' },
    });
    expect((await prisma.user.findUnique({ where: { id: referred.user.id } }))!.referredById).toBe(
      user.id,
    );
    expect(await prisma.ambassadorProfile.count({ where: { userId: user.id } })).toBe(1);
    const twice = await revoke(user.id);
    expect(twice.status).toBe(409);
    expect(twice.json.details).toEqual(['not_ambassador']);
    // Approved again: the same code, never another student's.
    const back = await approve(user.id);
    expect(back.json).toMatchObject({ promoCode, role: 'ambassador' });
    expect(await referrer(promoCode)).toBe(user.id);
  });

  it('refuses an unpaid account, a blocked student, staff, an unknown user and a missing reason', async () => {
    const unpaid = await makeUser(prisma, { role: 'student' });
    expect((await approve(unpaid.id)).json.details).toEqual(['not_paid_student']);
    const blocked = await registeredStudent(prisma, { isBlocked: true });
    expect((await approve(blocked.user.id)).json.details).toEqual(['blocked']);
    const jury = await makeUser(prisma, { role: 'jury' });
    expect((await approve(jury.id)).json.details).toEqual(['wrong_role']);
    expect((await approve('0190f000-0000-7000-8000-000000000000')).status).toBe(404);
    const { user } = await registeredStudent(prisma);
    const noReason = await call(
      env,
      'POST',
      `/admin/ambassadors/${user.id}/approve`,
      admin.cookie,
      {},
    );
    expect(noReason.status).toBe(400);
    const extra = await call(env, 'POST', `/admin/ambassadors/${user.id}/approve`, admin.cookie, {
      reason: 'good reason',
      promoCode: 'MY-OWN-CODE',
    });
    expect(extra.status).toBe(400); // the code is the server's, never chosen by the client
    expect(await prisma.ambassadorProfile.count({ where: { userId: user.id } })).toBe(0);
  });

  it('is for admins only: a student, a manager and a demoted admin get 403', async () => {
    const { user } = await registeredStudent(prisma);
    for (const role of ['student', 'ambassador', 'manager', 'jury'] as const) {
      const other = await sessionFor(env, prisma, { role });
      expect((await approve(user.id, other.cookie)).status).toBe(403);
      expect((await call(env, 'GET', '/admin/ambassadors', other.cookie)).status).toBe(403);
    }
    const demoted = await sessionFor(env, prisma, { role: 'admin' });
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'student' } });
    expect((await approve(user.id, demoted.cookie)).status).toBe(403);
    expect(await prisma.ambassadorProfile.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('lists and the panel', () => {
  it('lists with referral counts and points derived from rows, and filters by status and code', async () => {
    const mk = marker();
    const { user } = await registeredStudent(prisma, { name: `${mk} Amb` });
    const { promoCode } = (await approve(user.id)).json;
    await registeredStudent(prisma, { referredById: user.id });
    await registeredStudent(prisma, { referredById: user.id });
    await prisma.pointLedger.createMany({
      data: [
        { userId: user.id, eventKey: `t1:${mk}`, amount: 120, reason: 'test' },
        { userId: user.id, eventKey: `t2:${mk}`, amount: -20, reason: 'correction' },
      ],
    });
    const list = (q: string) =>
      call<Paginated<AdminAmbassadorRow>>(env, 'GET', `/admin/ambassadors${q}`, admin.cookie);
    const row = (await list(`?q=${mk}`)).json.items[0]!;
    expect(row).toMatchObject({
      userId: user.id,
      promoCode,
      referralCount: 2,
      points: 100,
      rankName: 'Silver',
    });
    expect((await list(`?q=${promoCode.toLowerCase()}`)).json.items.map((r) => r.userId)).toEqual([
      user.id,
    ]);
    await revoke(user.id);
    expect((await list(`?q=${mk}&status=approved`)).json.items).toEqual([]);
    expect((await list(`?q=${mk}&status=revoked`)).json.items.map((r) => r.userId)).toEqual([
      user.id,
    ]);
  });

  it('shows the ambassador their own panel: code, referrals without contact details, points and rank', async () => {
    const { user } = await registeredStudent(prisma, { name: 'Panel Amb' });
    const { promoCode } = (await approve(user.id)).json;
    const referred = await registeredStudent(prisma, {
      name: 'Referred One',
      institution: 'Test School',
      phone: testPhone(),
      referredById: user.id,
    });
    const issued = await env.sessions.start(
      { id: user.id, role: 'ambassador' },
      { ip: '203.0.113.41', userAgent: 'jest' },
    );
    const res = await call<AmbassadorOverview>(
      env,
      'GET',
      '/ambassador/me',
      `sirat_access=${issued.accessToken}`,
    );
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      promoCode,
      referralCount: 1,
      points: 0,
      rank: { current: { name: 'Bronze', minPoints: 0 }, next: { name: 'Silver', minPoints: 100 } },
      team: null,
      tasks: [],
      recentReferrals: [{ name: 'Referred One', institution: 'Test School' }],
    });
    expect(res.text).not.toContain(referred.user.email);
    expect(res.text).not.toContain(referred.user.phone!);
  });

  it('is for ambassadors only, and a revoked one is refused even with an ambassador token', async () => {
    const student = await sessionFor(env, prisma, { role: 'student' });
    expect((await call(env, 'GET', '/ambassador/me', student.cookie)).status).toBe(403);
    const { user } = await registeredStudent(prisma);
    await approve(user.id);
    const issued = await env.sessions.start(
      { id: user.id, role: 'ambassador' },
      { ip: '203.0.113.42', userAgent: 'jest' },
    );
    const cookie = `sirat_access=${issued.accessToken}`;
    expect((await call(env, 'GET', '/ambassador/me', cookie)).status).toBe(200);
    await revoke(user.id);
    expect((await call(env, 'GET', '/ambassador/me', cookie)).status).toBe(403);
  });
});

describe('database rules', () => {
  it('refuses a promo code outside the registration alphabet, and keeps the point ledger append-only', async () => {
    const u = await makeUser(prisma);
    await expect(
      prisma.ambassadorProfile.create({ data: { userId: u.id, promoCode: 'bad code!' } }),
    ).rejects.toThrow(/ambassador_profiles_promo_code_format_check/);
    const row = await prisma.pointLedger.create({
      data: { userId: u.id, eventKey: `t:${marker()}`, amount: 5, reason: 'test' },
    });
    await expect(
      prisma.pointLedger.update({ where: { id: row.id }, data: { amount: 500 } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.pointLedger.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only/,
    );
  });
});
