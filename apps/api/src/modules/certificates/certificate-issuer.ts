import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { IssueJobData } from './certificates-queue';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Who gets a certificate of a type in a round, from database state (core C6c; owner Q4 defaults). Blocked accounts
 * are left out.
 * - participation: everyone on the latest snapshot of the round's published exams whose results are published (an
 *   archived exam is retired, as for promotion);
 * - promotion: everyone with an entry in the round (a round after Round 1);
 * - winner: the named students who have an entry in the round (the final).
 * Demo data never counts (DECISIONS 2026-11-08 "Demo data"): demo accounts and demo exams are left out, so a real run
 * never gives a demo student a certificate from the real serial sequence (the demo loader writes its own).
 */
export function eligible(data: Pick<IssueJobData, 'type' | 'roundId' | 'userIds'>): Prisma.Sql {
  const round = Prisma.sql`${data.roundId}::uuid`;
  const source =
    data.type === 'participation'
      ? Prisma.sql`SELECT le."user_id" FROM "leaderboard_entries" le JOIN "exams" x ON x."id" = le."exam_id"
          WHERE x."round_id" = ${round} AND x."status"::text = 'published' AND x."results_published_at" IS NOT NULL
            AND x."demo_batch_id" IS NULL AND le."generation" = x."results_generation"`
      : data.type === 'promotion'
        ? Prisma.sql`SELECT e."user_id" FROM "round_entries" e WHERE e."round_id" = ${round}`
        : Prisma.sql`SELECT e."user_id" FROM "round_entries" e
            WHERE e."round_id" = ${round} AND e."user_id" = ANY(${data.userIds ?? []}::uuid[])`;
  return Prisma.sql`SELECT u."id", u."name" FROM "users" u
    WHERE u."is_blocked" = false AND u."demo_batch_id" IS NULL AND u."id" IN (${source})`;
}

/**
 * The worker's issue job: one `INSERT … SELECT … ON CONFLICT (user_id, type, round_id) DO NOTHING`, so it is
 * idempotent (run twice, it adds nothing). Each row gets the next serial (SLO-<year>-<number>), 12 random hex digits
 * as its verification code, and the name as it is now. A serial number drawn for a skipped row is simply not used.
 */
@Injectable()
export class CertificateIssuer {
  constructor(private readonly prisma: PrismaService) {}

  async issue(data: IssueJobData): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const issued = await tx.$executeRaw`
        INSERT INTO "certificates"
          ("id", "user_id", "type", "round_id", "serial", "verification_code", "name_on_certificate",
           "template_id")
        SELECT gen_random_uuid(), c."id", ${data.type}, ${data.roundId}::uuid,
               'SLO-' || to_char(now() AT TIME ZONE 'Asia/Dhaka', 'YYYY') || '-'
                 || lpad(nextval('certificate_serial_seq')::text, 6, '0'),
               upper(left(replace(gen_random_uuid()::text, '-', ''), 12)),
               left(c."name", 200),
               -- The type's active template VERSION at issue (C1), pinned: a later edit makes a new version.
               (SELECT t."id" FROM "certificate_templates" t WHERE t."type" = ${data.type} AND t."active")
        FROM (${eligible(data)}) c
        ON CONFLICT ("user_id", "type", "round_id") DO NOTHING`;
      await tx.auditLog.create({
        data: {
          action: 'certificates.issued',
          actorId: data.requestedBy,
          entityType: 'round',
          entityId: data.roundId,
          meta: { type: data.type, issued },
        },
      });
      return issued;
    });
  }

  /** How many would get one now, the ones who already have one included (the API's 202 shows it). */
  async candidates(
    db: Db,
    data: Pick<IssueJobData, 'type' | 'roundId' | 'userIds'>,
  ): Promise<number> {
    const [row] = await db.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM (${eligible(data)}) c`;
    return row?.n ?? 0;
  }
}
