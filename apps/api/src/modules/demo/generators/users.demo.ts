import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { BD_DISTRICTS, DEMO_EMAIL_DOMAIN, EDUCATION_TYPES } from '@sirat/shared';
import { FAMILY_BN, FAMILY_EN, GIVEN_BN, GIVEN_EN, INSTITUTIONS } from '../demo-names';
import type { DemoContext, DemoGenerator, DemoUser } from '../demo.types';

/** How many demo accounts of each role (lead's scope: about 300 students, 15 ambassadors, 2 jury; no admin). */
export const DEMO_USER_COUNTS = { students: 300, ambassadors: 15, jury: 2 } as const;

/** Demo phones come from this prefix (01999 + 6 digits); a number a real account or open form already holds is skipped. */
const PHONE_PREFIX = '01999';

/**
 * The demo accounts. Every one: the marker domain, demo_batch_id (the root marker; only the loader writes it), a
 * password for the jury only (students and ambassadors sign in with their participant ID), a verified email (so a demo student can take the practice exam), never an admin or manager. Grades
 * cover the whole list, so each category has students; districts, institutions and education types are spread.
 */
export const usersDemoGenerator: DemoGenerator = {
  area: 'users',
  dependsOn: [],
  async load(ctx: DemoContext): Promise<void> {
    await ctx.progress('users');
    const grades = await ctx.tx.gradeLevel.findMany({ orderBy: { sortOrder: 'asc' } });
    if (grades.length === 0)
      throw new Error('demo users: no grade levels (the reference data is missing)');
    const phones = await freePhones(
      ctx,
      DEMO_USER_COUNTS.students + DEMO_USER_COUNTS.ambassadors + DEMO_USER_COUNTS.jury,
    );

    const make = (role: DemoUser['role'], n: number): DemoUser => {
      const bangla = ctx.rng.chance(0.25);
      const name = bangla
        ? `${ctx.rng.pick(GIVEN_BN)} ${ctx.rng.pick(FAMILY_BN)}`
        : `${ctx.rng.pick(GIVEN_EN)} ${ctx.rng.pick(FAMILY_EN)}`;
      const grade = role === 'jury' ? null : ctx.rng.pick(grades);
      return {
        id: randomUUID(),
        email: `${role}-${String(n).padStart(3, '0')}@${DEMO_EMAIL_DOMAIN}`,
        phone: phones.shift()!,
        name,
        role,
        district: ctx.rng.pick(BD_DISTRICTS),
        institution: role === 'jury' ? 'Sirat Olympiad jury' : ctx.rng.pick(INSTITUTIONS),
        educationType: ctx.rng.pick(EDUCATION_TYPES),
        gradeLevelId: grade?.id ?? null,
        category: grade?.category ?? null,
      };
    };
    const students = Array.from({ length: DEMO_USER_COUNTS.students }, (_, i) =>
      make('student', i + 1),
    );
    const ambassadors = Array.from({ length: DEMO_USER_COUNTS.ambassadors }, (_, i) =>
      make('ambassador', i + 1),
    );
    const jury = Array.from({ length: DEMO_USER_COUNTS.jury }, (_, i) => make('jury', i + 1));
    const all = [...students, ...ambassadors, ...jury];

    const day = 86_400_000;
    const rows: Prisma.UserCreateManyInput[] = all.map((u) => {
      const createdAt = new Date(
        ctx.now.getTime() - (1 + ctx.rng.int(30)) * day - ctx.rng.int(day),
      );
      return {
        id: u.id,
        email: u.email,
        // Students and ambassadors sign in with email + participant ID (A2's login): no password (NULL), as the
        // users_password_for_staff CHECK wants; only the jury gets the load's one password.
        passwordHash: u.role === 'jury' ? ctx.passwordHash : null,
        name: u.name,
        phone: u.phone,
        district: u.district,
        institution: u.institution,
        educationType: u.educationType,
        gradeLevelId: u.gradeLevelId,
        category: u.category,
        role: u.role,
        emailVerifiedAt: createdAt,
        signupSource: 'demo',
        demoBatchId: ctx.batchId,
        createdAt,
        updatedAt: createdAt,
      };
    });
    await ctx.tx.user.createMany({ data: rows });
    await ctx.register(
      'users',
      all.map((u) => u.id),
    );
    ctx.users.students.push(...students);
    ctx.users.ambassadors.push(...ambassadors);
    ctx.users.jury.push(...jury);
  },
};

/** n free numbers in the demo range, from a seeded start, skipping any a real account or an open form holds. */
async function freePhones(ctx: DemoContext, n: number): Promise<string[]> {
  const taken = new Set<string>([
    ...(
      await ctx.tx.user.findMany({
        where: { phone: { startsWith: PHONE_PREFIX } },
        select: { phone: true },
      })
    ).map((u) => u.phone!),
    ...(
      await ctx.tx.$queryRaw<{ phone: string }[]>`
        SELECT "phone" FROM "pending_registrations" WHERE "phone" LIKE ${`${PHONE_PREFIX}%`}`
    ).map((r) => r.phone),
  ]);
  const out: string[] = [];
  let next = ctx.rng.int(900_000);
  while (out.length < n) {
    const phone = `${PHONE_PREFIX}${String(next % 1_000_000).padStart(6, '0')}`;
    if (!taken.has(phone)) out.push(phone);
    next += 1;
  }
  return out;
}
