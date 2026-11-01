import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BD_DISTRICTS,
  EDUCATION_TYPES,
  PROFILE_UPDATE_FIELDS,
  REGISTRATION_MESSAGES,
  type ProfileOptions,
  type ProfileRefusal,
  type StudentProfile,
} from '@sirat/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { currentRoundOf } from '../rounds/current-round';
import type { Actor } from './admin-users.service';
import type { CorrectGradeDto, UpdateProfileDto } from './dto/profile.dto';

type Tx = Prisma.TransactionClient;

const refuse = (...codes: ProfileRefusal[]) => new ConflictException(codes);
const invalid = (...codes: ProfileRefusal[]) => new BadRequestException(codes);

/** The owner's one text for any phone conflict (DECISIONS "Duplicate email and phone at registration"). */
const phoneTaken = () =>
  new ConflictException({
    code: 'PHONE_REGISTERED',
    message:
      REGISTRATION_MESSAGES.PHONE_REGISTERED?.en ?? 'This phone number is already registered.',
  });

const STUDENT_ROLES = ['student', 'ambassador'] as const;

const PROFILE_SELECT = {
  name: true,
  email: true,
  phone: true,
  district: true,
  institution: true,
  educationType: true,
  category: true,
  role: true,
  isBlocked: true,
  emailVerifiedAt: true,
  createdAt: true,
  gradeLevel: { select: { id: true, label: true } },
} satisfies Prisma.UserSelect;

type ProfileData = Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>;

function toProfile(
  u: ProfileData,
  round: { round: { id: string; name: string } } | null,
): StudentProfile {
  return {
    name: u.name,
    email: u.email,
    phone: u.phone,
    district: u.district,
    institution: u.institution,
    educationType: u.educationType,
    category: u.category,
    role: u.role,
    emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    gradeLevel: u.gradeLevel,
    currentRound: round && { id: round.round.id, name: round.round.name },
  };
}

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * The student's own profile (06-API "Student profile"; core plan section 4). No route takes an id: the user is the
 * session's. Each call re-reads the user, so a blocked account stops at once.
 */
@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string): Promise<StudentProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_SELECT,
    });
    if (!user || user.isBlocked) throw new ForbiddenException(['account_blocked']);
    return toProfile(user, await currentRoundOf(this.prisma, userId));
  }

  async options(): Promise<ProfileOptions> {
    const gradeLevels = await this.prisma.gradeLevel.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, label: true, category: true },
    });
    return { gradeLevels, educationTypes: [...EDUCATION_TYPES], districts: [...BD_DISTRICTS] };
  }

  /**
   * One transaction: re-read the user, refuse a phone another account has or an open registration attempt holds,
   * write the changed fields and the audit row (field names only, never the values: core plan D8).
   */
  async update(userId: string, dto: UpdateProfileDto, ip: string | null): Promise<StudentProfile> {
    const sent = PROFILE_UPDATE_FIELDS.filter((f) => dto[f] !== undefined);
    if (sent.length === 0) throw invalid('nothing_to_update');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
        if (!user || user.isBlocked) throw new ForbiddenException(['account_blocked']);
        const changed = sent.filter((f) => dto[f] !== user[f]);
        if (changed.length === 0) return toProfile(user, await currentRoundOf(tx, userId));
        if (changed.includes('phone')) await assertPhoneFree(tx, userId, dto.phone!);
        const data: Prisma.UserUpdateInput = {};
        for (const field of changed) data[field] = dto[field];
        const updated = await tx.user.update({
          where: { id: userId },
          data,
          select: PROFILE_SELECT,
        });
        await tx.auditLog.create({
          data: {
            action: 'user.profile_updated',
            actorId: userId,
            entityType: 'user',
            entityId: userId,
            ip,
            meta: { fields: changed },
          },
        });
        return toProfile(updated, await currentRoundOf(tx, userId));
      });
    } catch (e) {
      // Two people claiming one number at the same moment: the UNIQUE index decides, the loser gets the same text.
      if (isUniqueViolation(e)) throw phoneTaken();
      throw e;
    }
  }

  /**
   * An admin corrects a student's class and so the category (core plan Q1), only before the student's first exam
   * attempt: a category decides which exam a student sits. Audited with both labels and the reason.
   */
  async correctGrade(
    targetId: string,
    dto: CorrectGradeDto,
    actor: Actor,
  ): Promise<StudentProfile> {
    return this.prisma.$transaction(async (tx) => {
      const admin = await tx.user.findUnique({
        where: { id: actor.id },
        select: { role: true, isBlocked: true },
      });
      if (!admin || admin.role !== 'admin' || admin.isBlocked)
        throw new ForbiddenException('Forbidden resource');
      await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${targetId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: targetId }, select: PROFILE_SELECT });
      if (!user) throw new NotFoundException('User not found');
      if (!(STUDENT_ROLES as readonly string[]).includes(user.role)) throw refuse('not_a_student');
      const grade = await tx.gradeLevel.findUnique({
        where: { id: dto.gradeLevelId },
        select: { id: true, label: true, category: true },
      });
      if (!grade) throw invalid('grade_level_unknown');
      // exam's table, read only (core plan section 0)
      if ((await tx.attempt.count({ where: { userId: targetId } })) > 0)
        throw refuse('has_attempt');
      const updated = await tx.user.update({
        where: { id: targetId },
        data: { gradeLevelId: grade.id, category: grade.category },
        select: PROFILE_SELECT,
      });
      await tx.auditLog.create({
        data: {
          action: 'user.grade_corrected',
          actorId: actor.id,
          entityType: 'user',
          entityId: targetId,
          ip: actor.ip,
          meta: {
            from: user.gradeLevel?.label ?? null,
            to: grade.label,
            category: grade.category,
            reason: dto.reason,
          },
        },
      });
      return toProfile(updated, await currentRoundOf(tx, targetId));
    });
  }
}

/** Another account has the number, or a registration in progress holds it (payments' table, read only). */
async function assertPhoneFree(tx: Tx, userId: string, phone: string): Promise<void> {
  const owner = await tx.user.findFirst({
    where: { phone, id: { not: userId } },
    select: { id: true },
  });
  if (owner) throw phoneTaken();
  const attempt = await tx.pendingRegistration.findFirst({
    where: { phone, status: 'open' },
    select: { id: true },
  });
  if (attempt) throw phoneTaken();
}
