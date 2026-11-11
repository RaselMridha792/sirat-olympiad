import { ForbiddenException } from '@nestjs/common';
import type { Category } from '@sirat/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ExamConfig } from './exam-cache';

export interface StudentAccount {
  category: Category | null;
  emailVerifiedAt: Date | null;
  /** A demo account (DECISIONS 2026-11-08 "Demo data"): it sees and starts demo exams only. */
  demo: boolean;
  /**
   * The rounds where the student has a non-eliminated entry, loaded only when a round-gated exam is in question
   * (withRoundEntries). Not loaded: every gated exam stays hidden.
   */
  entryRoundIds?: ReadonlySet<string>;
}

/**
 * The student as the database knows them now (the token's role is up to 15 minutes old): a blocked account is
 * refused even with a valid token.
 */
export async function studentAccount(
  prisma: PrismaService,
  userId: string,
): Promise<StudentAccount> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isBlocked: true, category: true, emailVerifiedAt: true, demoBatchId: true },
  });
  if (!user || user.isBlocked) throw new ForbiddenException(['account_blocked']);
  return {
    category: user.category,
    emailVerifiedAt: user.emailVerifiedAt,
    demo: user.demoBatchId !== null,
  };
}

/**
 * Taking an exam needs a paid registration (EXAM-PLAN D3). There are no refunds (owner), and a registration can only
 * point at a paid payment (payments' trigger), but the payment's status is read here too. Read only: the registration
 * and payment tables belong to the payments module.
 */
export async function hasPaidRegistration(prisma: PrismaService, userId: string): Promise<boolean> {
  const registration = await prisma.registration.findUnique({
    where: { userId },
    select: { payment: { select: { status: true } } },
  });
  return registration?.payment.status === 'paid';
}

/**
 * A student sees published exams for everyone or for their own category (EXAM-PLAN D1). Demo data never mixes with real
 * data (DECISIONS 2026-11-08 "Demo data"): a demo exam only for demo accounts, a real exam only for real ones, so
 * removing the demo can never take a real attempt with it.
 */
export const visibleTo = (
  config: ExamConfig | null,
  student: Pick<StudentAccount, 'category' | 'demo' | 'entryRoundIds'>,
): config is ExamConfig =>
  config !== null &&
  config.status === 'published' &&
  (config.demo ?? false) === student.demo &&
  (config.category === null || config.category === student.category) &&
  roundOpenTo(config, student);

/**
 * The round rule (lead, 10 Nov): an exam in a round that is not its side's first round (config.roundGated) is only
 * for students a promotion put in that round, i.e. with a non-eliminated round entry there. The first round (real
 * Round 1, the demo's own Round 1) and exams without a round are open to all.
 */
export const roundOpenTo = (
  config: Pick<ExamConfig, 'roundId' | 'roundGated'>,
  student: Pick<StudentAccount, 'entryRoundIds'>,
): boolean =>
  !config.roundGated ||
  (config.roundId !== null && (student.entryRoundIds?.has(config.roundId) ?? false));

/**
 * The student's non-eliminated round entries, loaded only when one of `configs` is round-gated, so the start path of
 * a Round 1 exam (the surge) costs no extra query.
 */
export async function withRoundEntries<S extends StudentAccount>(
  prisma: Pick<PrismaService, 'roundEntry'>,
  userId: string,
  student: S,
  configs: readonly (ExamConfig | null)[],
): Promise<S> {
  if (!configs.some((c) => c?.roundGated)) return student;
  const rows = await prisma.roundEntry.findMany({
    where: { userId, status: { not: 'eliminated' } },
    select: { roundId: true },
  });
  return { ...student, entryRoundIds: new Set(rows.map((r) => r.roundId)) };
}
