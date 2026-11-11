import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { endSessionsOf } from '../../auth/end-sessions';
import { RegistrationEmails } from '../verify/registration-emails';

export type ReissueActor = { id: string; ip: string | null };

export interface ReissueResult {
  reissued: true;
  /** Sessions that were still active and are now ended (refresh fails; issued access tokens run out with their TTL). */
  sessionsEnded: number;
  /** False when the email could not be queued: the student can still use A2's "forgot ID". */
  emailQueued: boolean;
}

/**
 * "Issue a new participant ID" (DECISIONS "The participant ID", P1b; the lead: before launch). With ID login, a leaked
 * ID (an unmasked admit card) is a taken account, so an admin replaces it: in one transaction the database draws a new
 * ID (the same prefix; gen_participant_id never returns a taken value, so never the old one), every session of the
 * student ends (A2's endSessionsOf), and the audit records the reason and the count. Neither the old nor the new ID is
 * in the audit, a log or the response: the new one goes only to the student's email.
 */
@Injectable()
export class ParticipantIdReissueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: RegistrationEmails,
  ) {}

  async reissue(actor: ReissueActor, userId: string, reason: string): Promise<ReissueResult> {
    const done = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string; participant_id: string }[]>`
        UPDATE "registrations"
        SET "participant_id" = gen_participant_id(left("participant_id", 2)), "updated_at" = now()
        WHERE "user_id" = ${userId}::uuid
        RETURNING "id", "participant_id"`;
      if (!row) throw new NotFoundException('No registration for this user');
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true, name: true },
      });
      const sessionsEnded = await endSessionsOf(tx, userId);
      const audit = await tx.auditLog.create({
        data: {
          action: 'payments.participant_id_reissued',
          actorId: actor.id,
          ip: actor.ip,
          entityType: 'user',
          entityId: userId,
          meta: { reason, sessionsEnded, registrationId: row.id },
        },
        select: { id: true },
      });
      return { user, participantId: row.participant_id, sessionsEnded, auditId: audit.id };
    });
    const emailQueued = await this.emails.participantIdReissued(
      done.user,
      done.participantId,
      done.auditId,
    );
    return { reissued: true, sessionsEnded: done.sessionsEnded, emailQueued };
  }
}
