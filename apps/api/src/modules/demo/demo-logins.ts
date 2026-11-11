import type { PrismaClient } from '@prisma/client';
import { CATEGORIES, DEMO_LOGINS, type DemoLogin } from '@sirat/shared';

type Db = Pick<PrismaClient, 'user'>;

export interface DemoLoginList {
  logins: DemoLogin[];
  /** Demo students without a registration: no participant ID, so no login (they show the unpaid states). */
  unregisteredStudents: number;
}

/**
 * A few demo accounts to sign in with in front of a client (the admin card and the CLI; the lead, 2026-11-11): one
 * registered student per category, the first registered ambassadors, and the jury, by email. Only this batch's rows
 * (demo_batch_id), never a real account, never a blocked one. Students and ambassadors carry their participant ID
 * (A2's login); the jury has none and uses the load's password.
 */
export async function demoLogins(db: Db, batchId: string): Promise<DemoLoginList> {
  const select = {
    email: true,
    name: true,
    category: true,
    registration: { select: { participantId: true } },
  } as const;
  const registered = { demoBatchId: batchId, isBlocked: false, registration: { isNot: null } };
  const [students, ambassadors, jury, unregisteredStudents] = await Promise.all([
    // A small window ordered by email is enough to find each category (the generator spreads the grades).
    db.user.findMany({
      where: { ...registered, role: 'student' },
      orderBy: { email: 'asc' },
      take: 60,
      select,
    }),
    db.user.findMany({
      where: { ...registered, role: 'ambassador' },
      orderBy: { email: 'asc' },
      take: DEMO_LOGINS.ambassadors,
      select,
    }),
    db.user.findMany({
      where: { demoBatchId: batchId, isBlocked: false, role: 'jury' },
      orderBy: { email: 'asc' },
      take: DEMO_LOGINS.jury,
      select: { email: true, name: true },
    }),
    db.user.count({ where: { demoBatchId: batchId, role: 'student', registration: { is: null } } }),
  ]);
  const perCategory = CATEGORIES.map((c) => students.find((s) => s.category === c)).filter(
    (s): s is (typeof students)[number] => !!s,
  );
  const logins: DemoLogin[] = [
    ...perCategory.slice(0, DEMO_LOGINS.students).map((s) => ({
      role: 'student' as const,
      email: s.email,
      name: s.name,
      participantId: s.registration?.participantId ?? null,
    })),
    ...ambassadors.map((a) => ({
      role: 'ambassador' as const,
      email: a.email,
      name: a.name,
      participantId: a.registration?.participantId ?? null,
    })),
    ...jury.map((j) => ({
      role: 'jury' as const,
      email: j.email,
      name: j.name,
      participantId: null,
    })),
  ];
  return { logins, unregisteredStudents };
}
