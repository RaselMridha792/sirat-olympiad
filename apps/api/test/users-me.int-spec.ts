/**
 * The student's own profile and the admin's grade correction over HTTP (06-API "Student profile";
 * docs/plans/CORE-PLAN.md section 4): own data only, the allow-list, the owner's phone rule (another account,
 * a registration in progress, two claims at once), field names only in the audit row, blocked accounts, and the
 * grade correction before the first attempt. Real AppModule against the *_test database.
 */
import type { PrismaClient } from '@prisma/client';
import {
  BD_DISTRICTS,
  EDUCATION_TYPES,
  REGISTRATION_MESSAGES,
  type ApiError,
  type ProfileOptions,
  type StudentProfile,
} from '@sirat/shared';
import { bootCoreApp, call, registeredStudent, sessionFor, type CoreApp } from './core-helpers';
import { makeAttempt, makePublishedExam } from './exam-helpers';
import {
  applyReferenceData,
  makeRegistrationAttempt,
  makeUser,
  testPhone,
  testPrisma,
} from './helpers';

let env: CoreApp;
let prisma: PrismaClient;
let grades: { id: string; label: string; category: string }[];

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  if ((await prisma.gradeLevel.count()) === 0) await applyReferenceData(prisma);
  grades = await prisma.gradeLevel.findMany({ orderBy: { sortOrder: 'asc' } });
}, 60_000);

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

/** A registered student with a session, in a known starting state. */
async function student(data: Record<string, unknown> = {}) {
  const { user } = await registeredStudent(prisma, {
    name: 'Rahim Uddin',
    phone: testPhone(),
    district: 'Dhaka',
    institution: 'Dhaka College',
    educationType: EDUCATION_TYPES[0],
    gradeLevelId: grades[0]!.id,
    category: grades[0]!.category as never,
    ...data,
  });
  const issued = await env.sessions.start(
    { id: user.id, role: user.role },
    { ip: '203.0.113.31', userAgent: 'jest' },
  );
  return { user, cookie: `sirat_access=${issued.accessToken}` };
}

const patch = (cookie: string, body: unknown) =>
  call<StudentProfile & ApiError>(env, 'PATCH', '/users/me', cookie, body);

describe('GET /users/me and the options', () => {
  it("answers the session user's own profile, nothing more", async () => {
    const s = await student();
    const res = await call<StudentProfile>(env, 'GET', '/users/me', s.cookie);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      name: 'Rahim Uddin',
      email: s.user.email,
      phone: s.user.phone,
      district: 'Dhaka',
      gradeLevel: { id: grades[0]!.id, label: grades[0]!.label },
      currentRound: null,
    });
    expect(res.text).not.toMatch(/passwordHash|password_hash|\$argon2|not-a-real-hash|isBlocked/);
  });

  it('gives the 64 districts, the 5 education types and the grade table', async () => {
    const s = await student();
    const res = await call<ProfileOptions>(env, 'GET', '/content/profile-options', s.cookie);
    expect(res.status).toBe(200);
    expect(res.json.districts).toEqual([...BD_DISTRICTS]);
    expect(res.json.educationTypes).toEqual([...EDUCATION_TYPES]);
    expect(res.json.gradeLevels.map((g) => g.id)).toEqual(grades.map((g) => g.id));
  });

  it('is for students and ambassadors only, and a blocked student gets 403 with a valid token', async () => {
    const admin = await sessionFor(env, prisma, { role: 'admin' });
    expect((await call(env, 'GET', '/users/me', admin.cookie)).status).toBe(403);
    // The option lists are no personal data: admins read them for the grade correction, other staff do not.
    expect((await call(env, 'GET', '/content/profile-options', admin.cookie)).status).toBe(200);
    for (const role of ['manager', 'jury'] as const) {
      const staff = await sessionFor(env, prisma, { role });
      expect((await call(env, 'GET', '/content/profile-options', staff.cookie)).status).toBe(403);
    }
    expect((await patch(admin.cookie, { name: 'Admin' })).status).toBe(403);
    const s = await student();
    await prisma.user.update({ where: { id: s.user.id }, data: { isBlocked: true } });
    const me = await call<ApiError>(env, 'GET', '/users/me', s.cookie);
    expect(me.status).toBe(403);
    expect(me.json.details).toEqual(['account_blocked']);
    expect((await patch(s.cookie, { name: 'Someone Else' })).status).toBe(403);
  });
});

describe('PATCH /users/me', () => {
  it('changes the allowed fields and audits their names only', async () => {
    const s = await student();
    const res = await patch(s.cookie, {
      name: '  Karim   Uddin ',
      district: "Cox's Bazar",
      institution: 'Chittagong College',
      educationType: EDUCATION_TYPES[1],
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      name: 'Karim Uddin',
      district: "Cox's Bazar",
      institution: 'Chittagong College',
      educationType: EDUCATION_TYPES[1],
    });
    const audits = await prisma.auditLog.findMany({
      where: { actorId: s.user.id, action: 'user.profile_updated' },
    });
    expect(audits).toHaveLength(1);
    expect((audits[0]!.meta as { fields: string[] }).fields.sort()).toEqual(
      ['district', 'educationType', 'institution', 'name'].sort(),
    );
    expect(JSON.stringify(audits[0])).not.toMatch(/Karim|Chittagong|Cox/);
  });

  it('stores a phone given in any form once, as 01XXXXXXXXX', async () => {
    const s = await student();
    const phone = testPhone();
    for (const form of [
      `+88${phone}`,
      `88${phone}`,
      `${phone.slice(0, 5)}-${phone.slice(5)}`,
      phone,
    ]) {
      const res = await patch(s.cookie, { phone: form });
      expect(res.status).toBe(200);
      expect(res.json.phone).toBe(phone);
    }
    // Only the first call changed anything; the same number again writes no audit row.
    expect(
      await prisma.auditLog.count({
        where: { actorId: s.user.id, action: 'user.profile_updated' },
      }),
    ).toBe(1);
  });

  it("refuses a phone another account has, or a registration in progress holds, with the owner's text", async () => {
    const s = await student();
    const other = await makeUser(prisma, { phone: testPhone() });
    const held = testPhone();
    await makeRegistrationAttempt(prisma, { phone: held });
    for (const phone of [other.phone!, held]) {
      const res = await patch(s.cookie, { phone });
      expect(res.status).toBe(409);
      expect(res.json.code).toBe('PHONE_REGISTERED');
      expect(res.json.message).toBe(REGISTRATION_MESSAGES.PHONE_REGISTERED!.en);
    }
    expect((await prisma.user.findUnique({ where: { id: s.user.id } }))!.phone).toBe(s.user.phone);
  });

  it('lets exactly one of two students take a free number claimed at the same moment', async () => {
    const a = await student();
    const b = await student();
    const phone = testPhone();
    const results = await Promise.all([patch(a.cookie, { phone }), patch(b.cookie, { phone })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.json.code).toBe('PHONE_REGISTERED');
    expect(await prisma.user.count({ where: { phone } })).toBe(1);
  });

  it('answers 409, not 500, when the number is taken between its check and its write', async () => {
    // Another transaction takes the number and holds its commit for a second: the PATCH passes the check (nothing
    // committed yet), waits on the UNIQUE index, then gets the unique violation when that commit lands.
    const s = await student();
    const other = await makeUser(prisma, { phone: testPhone() });
    const phone = testPhone();
    const holder = prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: other.id }, data: { phone } });
      await tx.$executeRaw`SELECT pg_sleep(1)`;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const res = await patch(s.cookie, { phone });
    await holder;
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('PHONE_REGISTERED');
    expect((await prisma.user.findUnique({ where: { id: s.user.id } }))!.phone).toBe(s.user.phone);
  });

  it('refuses every field it does not own, invalid values and an empty body', async () => {
    const s = await student();
    for (const body of [
      { email: 'new@test.invalid' },
      { gradeLevelId: grades[1]!.id },
      { role: 'admin' },
      { category: 'achiever' },
      { promoCode: 'SR-AAAAAA' },
      { name: 'X' },
      { name: '' },
      { phone: '01212345678' },
      { district: 'Calcutta' },
      { institution: 'A' },
      { educationType: 'Other' },
      { phone: null },
    ])
      expect((await patch(s.cookie, body)).status).toBe(400);
    const empty = await patch(s.cookie, {});
    expect(empty.status).toBe(400);
    expect(empty.json.details).toEqual(['nothing_to_update']);
    const after = await prisma.user.findUnique({ where: { id: s.user.id } });
    expect(after).toMatchObject({
      role: 'student',
      name: 'Rahim Uddin',
      gradeLevelId: grades[0]!.id,
    });
  });
});

describe('POST /admin/users/:id/grade-level', () => {
  const correct = (cookie: string, id: string, body: unknown) =>
    call<StudentProfile & ApiError>(env, 'POST', `/admin/users/${id}/grade-level`, cookie, body);

  it('moves the student to the new class and its category, audited with both labels and the reason', async () => {
    const admin = await sessionFor(env, prisma, { role: 'admin' });
    const s = await student();
    const target = grades.find((g) => g.category !== grades[0]!.category)!;
    const res = await correct(admin.cookie, s.user.id, {
      gradeLevelId: target.id,
      reason: 'typo at registration',
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      gradeLevel: { id: target.id, label: target.label },
      category: target.category,
    });
    const audit = await prisma.auditLog.findFirst({
      where: { actorId: admin.id, action: 'user.grade_corrected', entityId: s.user.id },
    });
    expect(audit?.meta).toEqual({
      from: grades[0]!.label,
      to: target.label,
      category: target.category,
      reason: 'typo at registration',
    });
  });

  it('is refused once the student has an exam attempt, for staff, and for an unknown grade or user', async () => {
    const admin = await sessionFor(env, prisma, { role: 'admin' });
    const s = await student();
    const exam = await makePublishedExam(prisma);
    await makeAttempt(prisma, s.user.id, exam.id);
    const late = await correct(admin.cookie, s.user.id, {
      gradeLevelId: grades[1]!.id,
      reason: 'late',
    });
    expect(late.status).toBe(409);
    expect(late.json.details).toEqual(['has_attempt']);
    const staff = await makeUser(prisma, { role: 'jury' });
    expect(
      (await correct(admin.cookie, staff.id, { gradeLevelId: grades[1]!.id, reason: 'staff' })).json
        .details,
    ).toEqual(['not_a_student']);
    const fresh = await student();
    const unknownGrade = await correct(admin.cookie, fresh.user.id, {
      gradeLevelId: '0190f000-0000-7000-8000-000000000000',
      reason: 'unknown grade',
    });
    expect(unknownGrade.status).toBe(400);
    expect(unknownGrade.json.details).toEqual(['grade_level_unknown']);
    expect(
      (
        await correct(admin.cookie, '0190f000-0000-7000-8000-000000000001', {
          gradeLevelId: grades[1]!.id,
          reason: 'nobody',
        })
      ).status,
    ).toBe(404);
    expect(
      (await correct(admin.cookie, fresh.user.id, { gradeLevelId: grades[1]!.id })).status,
    ).toBe(400);
    expect((await prisma.user.findUnique({ where: { id: fresh.user.id } }))!.gradeLevelId).toBe(
      grades[0]!.id,
    );
  });

  it('is for admins only: a student, a manager and a demoted admin get 403', async () => {
    const s = await student();
    const body = { gradeLevelId: grades[1]!.id, reason: 'not mine to change' };
    expect((await correct(s.cookie, s.user.id, body)).status).toBe(403);
    const manager = await sessionFor(env, prisma, { role: 'manager' });
    expect((await correct(manager.cookie, s.user.id, body)).status).toBe(403);
    const demoted = await sessionFor(env, prisma, { role: 'admin' });
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'student' } });
    expect((await correct(demoted.cookie, s.user.id, body)).status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: s.user.id } }))!.gradeLevelId).toBe(
      grades[0]!.id,
    );
  });
});
