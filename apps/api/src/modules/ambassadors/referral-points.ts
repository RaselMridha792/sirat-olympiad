import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const POINTS_PER_REFERRAL_KEY = 'ambassador_points_per_referral';
/** The core plan's Q3 default (unanswered by the owner); admins change it in /admin/ambassador-points. */
export const DEFAULT_POINTS_PER_REFERRAL = 10;
/** The 5-minute run looks this far back; the nightly back-fill covers the rest. */
export const RECENT_WINDOW_MS = 2 * 86_400_000;
export const REFERRAL_EVENT_PREFIX = 'referral_paid:';

export type SweepMode = 'recent' | 'full';
export interface SweepResult {
  mode: SweepMode;
  awarded: number;
}

/** The points per referral now: the admin's setting, or the default when the row is missing or not a whole number. */
export async function pointsPerReferral(db: Pick<PrismaService, 'setting'>): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: POINTS_PER_REFERRAL_KEY } });
  const value = row?.value;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : DEFAULT_POINTS_PER_REFERRAL;
}

/**
 * Referral points (core C5b, CORE-PLAN §6): one ledger row per paid registration with a referrer, keyed
 * `referral_paid:<paymentId>`. One statement, `ON CONFLICT (event_key) DO NOTHING`: run twice or by two workers at
 * once, it adds nothing twice, and it back-fills every earlier referral. It reads payments' registrations and writes
 * only the ledger. A referral counts even if the ambassador was revoked later: payments took the code while it was
 * valid, and earlier points stay. The amount is the setting at sweep time; earlier rows never change.
 */
@Injectable()
export class ReferralPoints {
  private readonly logger = new Logger(ReferralPoints.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(mode: SweepMode, now: Date = new Date()): Promise<SweepResult> {
    const points = await pointsPerReferral(this.prisma);
    if (points === 0) return { mode, awarded: 0 }; // nothing to give; a later value back-fills them
    // The first run ever looks at every registration, so the first award never waits for the night.
    const effective: SweepMode =
      mode === 'recent' && !(await this.anyReferralAwarded()) ? 'full' : mode;
    const since =
      effective === 'recent'
        ? Prisma.sql`AND r."created_at" >= ${new Date(now.getTime() - RECENT_WINDOW_MS)}`
        : Prisma.empty;
    const awarded = await this.prisma.$executeRaw`
      INSERT INTO "point_ledger" ("id", "user_id", "event_key", "amount", "reason")
      SELECT gen_random_uuid(), u."referred_by_id", ${REFERRAL_EVENT_PREFIX} || r."payment_id"::text, ${points}, 'referral'
      FROM "registrations" r
      JOIN "users" u ON u."id" = r."user_id"
      WHERE u."referred_by_id" IS NOT NULL ${since}
      ON CONFLICT ("event_key") DO NOTHING`;
    if (awarded > 0) this.logger.log({ msg: 'referral points awarded', mode: effective, awarded });
    return { mode: effective, awarded };
  }

  /** A range on the UNIQUE(event_key) index (`;` sorts right after `:`), never a LIKE scan. */
  private async anyReferralAwarded(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT 1 FROM "point_ledger"
      WHERE "event_key" >= ${REFERRAL_EVENT_PREFIX} AND "event_key" < ${'referral_paid;'}
      LIMIT 1`;
    return rows.length > 0;
  }
}
