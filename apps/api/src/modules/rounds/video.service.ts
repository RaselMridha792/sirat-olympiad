import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isAllowedVideoUrl, type MyRound } from '@sirat/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { myRoundIn } from './current-round';
import type { Actor } from './rounds.service';

const conflict = (code: string) => new ConflictException([code]);

/**
 * A student's video for a video round (core C6b, CORE-PLAN §7): own entry only, inside the window by server time,
 * changeable until the close; https to an allowed host only (YouTube, Google Drive). The link is never logged or
 * audited (a minor's free text: the audit row keeps ids), and the student sees it back as text.
 */
@Injectable()
export class VideoService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(roundId: string, url: string, actor: Actor): Promise<MyRound> {
    await assertMember(this.prisma, actor.id);
    if (!isAllowedVideoUrl(url)) throw new BadRequestException(['bad_video_url']);
    await this.prisma.$transaction(async (tx) => {
      // A share lock on the round: many students send at once, but never while a promotion (FOR UPDATE) runs.
      const [round] = await tx.$queryRaw<
        Array<{ type: string; opens_at: Date | null; closes_at: Date | null }>
      >`SELECT "type"::text AS type, "opens_at", "closes_at" FROM "rounds" WHERE "id" = ${roundId}::uuid FOR SHARE`;
      if (!round) throw new NotFoundException('Round not found');
      const entry = await tx.roundEntry.findUnique({
        where: { userId_roundId: { userId: actor.id, roundId } },
        select: { id: true, status: true },
      });
      // Not the student's round (not promoted into it): the same answer as a round that does not exist.
      if (!entry) throw new NotFoundException('Round not found');
      if (round.type !== 'video') throw conflict('not_video_round');
      const now = new Date();
      if (!round.opens_at || round.opens_at > now) throw conflict('window_not_open');
      if (!round.closes_at || round.closes_at <= now) throw conflict('window_closed');
      if (entry.status !== 'pending' && entry.status !== 'submitted')
        throw conflict('entry_closed');
      await tx.roundEntry.update({
        where: { id: entry.id },
        data: { videoUrl: url, videoSubmittedAt: now, status: 'submitted' },
      });
      await tx.auditLog.create({
        data: {
          action: 'round.video_submitted',
          actorId: actor.id,
          entityType: 'round_entry',
          entityId: entry.id,
          ip: actor.ip,
          meta: { roundId },
        },
      });
    });
    return (await myRoundIn(this.prisma, actor.id, roundId))!;
  }
}

/** A student or an ambassador who is not blocked, re-read (the token's role may be older). */
async function assertMember(db: PrismaService, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true },
  });
  if (!user || user.isBlocked || (user.role !== 'student' && user.role !== 'ambassador'))
    throw new ForbiddenException('Forbidden resource');
}
