import type { Prisma } from '@prisma/client';
import type { MyRound } from '@sirat/shared';
import type { PrismaService } from '../../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

const ROUND_SELECT = {
  id: true,
  name: true,
  type: true,
  sortOrder: true,
  opensAt: true,
  closesAt: true,
} as const satisfies Prisma.RoundSelect;

type RoundRow = Prisma.RoundGetPayload<{ select: typeof ROUND_SELECT }>;

const toRound = (r: RoundRow): MyRound['round'] => ({
  id: r.id,
  name: r.name,
  type: r.type,
  sortOrder: r.sortOrder,
  opensAt: r.opensAt?.toISOString() ?? null,
  closesAt: r.closesAt?.toISOString() ?? null,
});

/**
 * The student's current round (core C6a): the latest round they have an entry in, with its status; with no entry
 * yet (before Round 1's promotion), the first round. Used by GET /rounds/me and the profile.
 * By the viewer's side (demo data, DECISIONS 2026-11-08): a real account sees real rounds only and a demo account its
 * demo rounds only (demo data has its own Round 1, sort orders 101-110).
 */
export async function currentRoundOf(db: Db, userId: string): Promise<MyRound | null> {
  const viewer = await db.user.findUnique({ where: { id: userId }, select: { demoBatchId: true } });
  const visible: Prisma.RoundWhereInput = {
    demoBatchId: viewer?.demoBatchId ? { not: null } : null,
  };
  const entry = await db.roundEntry.findFirst({
    where: { userId, round: visible },
    orderBy: { round: { sortOrder: 'desc' } },
    select: {
      status: true,
      videoUrl: true,
      videoSubmittedAt: true,
      round: { select: ROUND_SELECT },
    },
  });
  if (entry)
    return {
      round: toRound(entry.round),
      entryStatus: entry.status,
      videoUrl: entry.videoUrl,
      videoSubmittedAt: entry.videoSubmittedAt?.toISOString() ?? null,
    };
  const first = await db.round.findFirst({
    where: visible,
    orderBy: { sortOrder: 'asc' },
    select: ROUND_SELECT,
  });
  return (
    first && { round: toRound(first), entryStatus: null, videoUrl: null, videoSubmittedAt: null }
  );
}

/** The student's own entry in one round, as GET /rounds/me shows it; null without an entry there. */
export async function myRoundIn(db: Db, userId: string, roundId: string): Promise<MyRound | null> {
  const entry = await db.roundEntry.findUnique({
    where: { userId_roundId: { userId, roundId } },
    select: {
      status: true,
      videoUrl: true,
      videoSubmittedAt: true,
      round: { select: ROUND_SELECT },
    },
  });
  return (
    entry && {
      round: toRound(entry.round),
      entryStatus: entry.status,
      videoUrl: entry.videoUrl,
      videoSubmittedAt: entry.videoSubmittedAt?.toISOString() ?? null,
    }
  );
}
