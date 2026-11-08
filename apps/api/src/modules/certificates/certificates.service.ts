import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CERTIFICATE_CODE_PATTERN,
  type AdminCertificateRow,
  type CertificateCheck,
  type CertificateIssueRequest,
  type CertificateIssueResult,
  type CertificateRevokeRequest,
  type CertificateType,
  type MyCertificate,
  type Paginated,
} from '@sirat/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CertificateIssuer } from './certificate-issuer';
import { CertificatesQueue } from './certificates.queue';

export interface Actor {
  id: string;
  ip: string | null;
}

const conflict = (code: string) => new ConflictException([code]);
const DEFAULT_PAGE_SIZE = 20;
const SERIAL = /^SLO-\d{4}-\d{6,}$/;

const ROW_SELECT = {
  id: true,
  type: true,
  serial: true,
  nameOnCertificate: true,
  issuedAt: true,
  revokedAt: true,
  revokeReason: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true, demoBatchId: true } },
  round: { select: { id: true, name: true } },
} as const satisfies Prisma.CertificateSelect;
type RowData = Prisma.CertificateGetPayload<{ select: typeof ROW_SELECT }>;

const toRow = (c: RowData): AdminCertificateRow => ({
  id: c.id,
  user: { userId: c.user.id, name: c.user.name, email: c.user.email },
  type: c.type as CertificateType,
  round: c.round,
  serial: c.serial,
  nameOnCertificate: c.nameOnCertificate,
  issuedAt: c.issuedAt.toISOString(),
  revokedAt: c.revokedAt?.toISOString() ?? null,
  revokeReason: c.revokeReason,
  updatedAt: c.updatedAt.toISOString(),
  demo: c.user.demoBatchId !== null,
});

/**
 * Certificates (core C6c, CORE-PLAN §7; the lead's notes; owner Q4 defaults). Admins ask for an issue run, which the
 * worker does (DO 8: slow work in the queue); they list and revoke (never delete). A student sees their own. The
 * public check answers only the name and the award, the same 404 for unknown, malformed and revoked codes.
 */
@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: CertificatesQueue,
    private readonly issuer: CertificateIssuer,
  ) {}

  // ───────────── Admin ─────────────

  async issue(body: CertificateIssueRequest, actor: Actor): Promise<CertificateIssueResult> {
    await assertAdmin(this.prisma, actor.id);
    const round = await this.prisma.round.findUnique({
      where: { id: body.roundId },
      select: { id: true, type: true, sortOrder: true, demoBatchId: true },
    });
    if (!round) throw new NotFoundException('Round not found');
    // A demo round's certificates come with the demo data (their own serial range), never from an issue run.
    if (round.demoBatchId !== null) throw conflict('demo_round');

    let userIds: string[] | undefined;
    if (body.type === 'participation') {
      if (round.type !== 'quiz') throw conflict('wrong_round');
      // A demo exam on the real Round 1 (demo data) never makes the round's results count as published.
      const published = await this.prisma.exam.count({
        where: {
          roundId: round.id,
          status: 'published',
          resultsPublishedAt: { not: null },
          demoBatchId: null,
        },
      });
      if (published === 0) throw conflict('results_not_published');
    } else if (body.type === 'promotion') {
      if (round.sortOrder === 1) throw conflict('wrong_round');
    } else {
      if (round.type !== 'final') throw conflict('wrong_round');
      if (!body.emails?.length || !body.reason) throw new BadRequestException(['no_winners']);
      // users.email is CITEXT: any letter case matches.
      const users = await this.prisma.user.findMany({
        where: { email: { in: body.emails } },
        select: { id: true },
      });
      if (users.length !== new Set(body.emails.map((e) => e.toLowerCase())).size)
        throw conflict('unknown_user');
      userIds = users.map((u) => u.id);
      const inRound = await this.prisma.roundEntry.count({
        where: { roundId: round.id, userId: { in: userIds } },
      });
      if (inRound !== userIds.length) throw conflict('not_in_round');
    }
    if (body.type !== 'winner' && body.emails !== undefined)
      throw new BadRequestException(['no_winners']);

    const data = { type: body.type, roundId: round.id, userIds };
    const candidates = await this.issuer.candidates(this.prisma, data);
    if (!(await this.queue.issue({ ...data, requestedBy: actor.id })))
      throw new ServiceUnavailableException(['queue_unavailable']);
    await this.prisma.auditLog.create({
      data: {
        action: 'certificates.issue_requested',
        actorId: actor.id,
        entityType: 'round',
        entityId: round.id,
        ip: actor.ip,
        meta: {
          type: body.type,
          candidates,
          ...(body.type === 'winner' ? { winners: userIds!.length, reason: body.reason! } : {}),
        },
      },
    });
    return { queued: true, type: body.type, roundId: round.id, candidates };
  }

  async list(
    actorId: string,
    q: { q?: string; type?: CertificateType; round?: string; page?: number; pageSize?: number },
  ): Promise<Paginated<AdminCertificateRow>> {
    await assertAdmin(this.prisma, actorId);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.CertificateWhereInput = {
      ...(q.type ? { type: q.type } : {}),
      ...(q.round ? { roundId: q.round } : {}),
      ...(q.q
        ? SERIAL.test(q.q.toUpperCase())
          ? { serial: q.q.toUpperCase() }
          : { nameOnCertificate: { contains: q.q, mode: 'insensitive' } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.certificate.count({ where }),
      this.prisma.certificate.findMany({
        where,
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: ROW_SELECT,
      }),
    ]);
    return { items: rows.map(toRow), page, pageSize, total };
  }

  async revoke(
    id: string,
    body: CertificateRevokeRequest,
    actor: Actor,
  ): Promise<AdminCertificateRow> {
    await assertAdmin(this.prisma, actor.id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "certificates" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const found = await tx.certificate.findUnique({
        where: { id },
        select: { revokedAt: true, updatedAt: true },
      });
      if (!found) throw new NotFoundException('Certificate not found');
      if (found.updatedAt.toISOString() !== new Date(body.expectedUpdatedAt).toISOString())
        throw conflict('stale');
      if (found.revokedAt) throw conflict('already_revoked');
      const row = await tx.certificate.update({
        where: { id },
        data: { revokedAt: new Date(), revokedById: actor.id, revokeReason: body.reason },
        select: ROW_SELECT,
      });
      // The PDF, when C6c-2 renders one, is dropped from the cache here.
      await tx.auditLog.create({
        data: {
          action: 'certificate.revoked',
          actorId: actor.id,
          entityType: 'certificate',
          entityId: id,
          ip: actor.ip,
          meta: { reason: body.reason },
        },
      });
      return toRow(row);
    });
  }

  // ───────────── Student ─────────────

  /** A student's own certificates: a few at most (one per type and round), so no paging. */
  async mine(userId: string): Promise<MyCertificate[]> {
    await assertMember(this.prisma, userId);
    const rows = await this.prisma.certificate.findMany({
      where: { userId },
      orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        serial: true,
        verificationCode: true,
        nameOnCertificate: true,
        issuedAt: true,
        revokedAt: true,
        round: { select: { id: true, name: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      type: c.type as CertificateType,
      round: c.round,
      serial: c.serial,
      verificationCode: c.verificationCode,
      nameOnCertificate: c.nameOnCertificate,
      issuedAt: c.issuedAt.toISOString(),
      revoked: c.revokedAt !== null,
    }));
  }

  // ───────────── Public ─────────────

  /** The name and the award only (lead). Unknown, malformed and revoked codes get the same 404. */
  async check(code: string): Promise<CertificateCheck> {
    const notValid = () => new NotFoundException('Certificate not found');
    if (!CERTIFICATE_CODE_PATTERN.test(code)) throw notValid();
    const found = await this.prisma.certificate.findUnique({
      where: { verificationCode: code.toUpperCase() },
      select: {
        type: true,
        nameOnCertificate: true,
        revokedAt: true,
        round: { select: { name: true } },
        user: { select: { demoBatchId: true } },
      },
    });
    if (!found || found.revokedAt) throw notValid();
    return {
      name: found.nameOnCertificate,
      award: { type: found.type as CertificateType, roundName: found.round.name },
      demo: found.user.demoBatchId !== null,
    };
  }
}

async function assertAdmin(db: PrismaService, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true },
  });
  if (!user || user.role !== 'admin' || user.isBlocked)
    throw new ForbiddenException('Forbidden resource');
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
