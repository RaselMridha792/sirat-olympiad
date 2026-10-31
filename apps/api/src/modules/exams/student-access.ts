import { ForbiddenException } from '@nestjs/common';
import type { Category } from '@sirat/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ExamConfig } from './exam-cache';

export interface StudentAccount {
  category: Category | null;
  emailVerifiedAt: Date | null;
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
    select: { isBlocked: true, category: true, emailVerifiedAt: true },
  });
  if (!user || user.isBlocked) throw new ForbiddenException(['account_blocked']);
  return { category: user.category, emailVerifiedAt: user.emailVerifiedAt };
}

/** A student sees published exams for everyone or for their own category (EXAM-PLAN D1). */
export const visibleTo = (
  config: ExamConfig | null,
  category: Category | null,
): config is ExamConfig =>
  config !== null &&
  config.status === 'published' &&
  (config.category === null || config.category === category);
