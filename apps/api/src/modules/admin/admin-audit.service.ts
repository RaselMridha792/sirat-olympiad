import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import {
  ADMIN_AUDIT_EXPORT,
  type AdminAuditDetail,
  type AdminAuditFilters,
  type AdminAuditPage,
  type AdminAuditQuery,
  type AdminAuditRow,
} from '@sirat/shared';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { CSV_BOM, csvRow, dhakaDateTime } from '../../common/csv';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_EXPORT_COLUMNS, auditCsvRow } from './audit-csv';

export interface Actor {
  id: string;
  ip: string | null;
}

export interface AuditExport {
  rowCount: number;
  filename: string;
  chunks: AsyncGenerator<string>;
}

const DHAKA_OFFSET_MS = 6 * 3_600_000; // Asia/Dhaka is UTC+6 all year
const DAY_MS = 86_400_000;
const EXPORT_BATCH = 1_000;
const TS_US = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface RawRow {
  id: string;
  createdAt: Date;
  /** created_at to the microsecond: the keyset cursor must not lose the part a JS Date drops. */
  createdAtUs: string;
  action: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  actorName: string | null;
  actorRole: Role | null;
  meta?: unknown;
}

const refuse = (code: string) => new BadRequestException([code]);

/**
 * The admin audit-log viewer (06-API "Audit log"; lead 2026-11-01). Admins only, read only: the table is append-only.
 * The list never carries the IP, an email or the meta; an admin opens one row for those. Paging is keyset on
 * (created_at, id), newest first, so a busy log (every failed login writes a row) never needs OFFSET.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(actorId: string, q: AdminAuditQuery): Promise<AdminAuditPage> {
    await this.assertAdmin(actorId);
    const where = await this.conditions(q);
    if (!where) return { items: [], next: null };
    const limit = q.limit ?? ADMIN_AUDIT_EXPORT.pageSize;
    const cursor = q.before ? decodeCursor(q.before) : null;
    const rows = await this.page(where, cursor, limit + 1, false);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map(toRow),
      next: rows.length > limit && last ? encodeCursor(last.createdAtUs, last.id) : null,
    };
  }

  async get(actorId: string, id: string): Promise<AdminAuditDetail> {
    await this.assertAdmin(actorId);
    const row = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Audit entry not found');
    const actor = row.actorId
      ? await this.prisma.user.findUnique({
          where: { id: row.actorId },
          select: { name: true, role: true, email: true },
        })
      : null;
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      system: row.actorId === null,
      actor: actor ? { name: actor.name, role: actor.role } : null,
      entityType: row.entityType,
      entityId: row.entityId,
      ip: row.ip,
      actorEmail: actor?.email ?? null,
      meta: row.meta ?? null,
    };
  }

  /**
   * Counts the rows, writes the export's own audit row, then streams the CSV in keyset batches. No IP and no email
   * leave this way; the meta is redacted (audit-csv.ts). Without its audit row nothing is exported.
   */
  async export(filters: AdminAuditFilters, reason: string, actor: Actor): Promise<AuditExport> {
    await this.assertAdmin(actor.id);
    const where = await this.conditions(filters);
    const rowCount = where ? await this.count(where) : 0;
    if (rowCount > ADMIN_AUDIT_EXPORT.maxRows) throw refuse('too_many_rows');
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'audit.exported',
          actorId: actor.id,
          entityType: 'audit_log',
          ip: actor.ip,
          meta: { filters: filterKinds(filters), rowCount, reason },
        },
      });
    } catch (e) {
      this.logger.error({ msg: 'audit export record failed', ...errorLogFields(e) });
      throw new ServiceUnavailableException('The export could not be recorded. Try again.');
    }
    const stamp = dhakaDateTime(new Date()).replace(/[-: ]/g, '').slice(0, 12);
    return { rowCount, filename: `audit-log-${stamp}.csv`, chunks: this.rows(where) };
  }

  private async *rows(where: Prisma.Sql[] | null): AsyncGenerator<string> {
    yield CSV_BOM + csvRow(AUDIT_EXPORT_COLUMNS);
    if (!where) return;
    let cursor: { ts: string; id: string } | null = null;
    for (;;) {
      const batch = await this.page(where, cursor, EXPORT_BATCH, true);
      if (batch.length === 0) return;
      yield batch
        .map((r) =>
          auditCsvRow({
            createdAt: r.createdAt,
            action: r.action,
            actorName: r.actorName,
            actorRole: r.actorRole,
            system: r.actorId === null,
            entityType: r.entityType,
            entityId: r.entityId,
            meta: r.meta,
          }),
        )
        .join('');
      if (batch.length < EXPORT_BATCH) return;
      const last = batch[batch.length - 1]!;
      cursor = { ts: last.createdAtUs, id: last.id };
    }
  }

  /** One page, newest first. The row comparison runs on the (created_at DESC, id DESC) index. */
  private page(
    where: Prisma.Sql[],
    cursor: { ts: string; id: string } | null,
    take: number,
    withMeta: boolean,
  ): Promise<RawRow[]> {
    const conditions = cursor
      ? [
          ...where,
          Prisma.sql`(a."created_at", a."id") < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`,
        ]
      : where;
    return this.prisma.$queryRaw<RawRow[]>`
      SELECT a."id", a."created_at" AS "createdAt",
             to_char(a."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAtUs",
             a."action", a."actor_id" AS "actorId", a."entity_type" AS "entityType", a."entity_id" AS "entityId",
             u."name" AS "actorName", u."role" AS "actorRole"
             ${withMeta ? Prisma.sql`, a."meta"` : Prisma.empty}
      FROM "audit_logs" a
      LEFT JOIN "users" u ON u."id" = a."actor_id"
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY a."created_at" DESC, a."id" DESC
      LIMIT ${take}`;
  }

  private async count(where: Prisma.Sql[]): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS "n" FROM "audit_logs" a WHERE ${Prisma.join(where, ' AND ')}`;
    return row?.n ?? 0;
  }

  /** The filters as SQL conditions; null when the actor's email belongs to no account (nothing can match). */
  private async conditions(f: AdminAuditFilters): Promise<Prisma.Sql[] | null> {
    const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (f.action) {
      where.push(
        f.action.endsWith('.*')
          ? Prisma.sql`starts_with(a."action", ${f.action.slice(0, -1)})`
          : Prisma.sql`a."action" = ${f.action}`,
      );
    }
    if (f.actor === 'system') where.push(Prisma.sql`a."actor_id" IS NULL`);
    else if (f.actor) {
      const user = await this.prisma.user.findUnique({
        where: { email: f.actor },
        select: { id: true },
      });
      if (!user) return null;
      where.push(Prisma.sql`a."actor_id" = ${user.id}::uuid`);
    }
    const from = f.from ? dhakaDayStart(f.from) : null;
    const to = f.to ? dhakaDayStart(f.to) : null;
    if (from && to && from > to) throw refuse('bad_range');
    if (from) where.push(Prisma.sql`a."created_at" >= ${from}`);
    if (to) where.push(Prisma.sql`a."created_at" < ${new Date(to.getTime() + DAY_MS)}`);
    return where;
  }

  /** Roles come from the token (15 min); every call re-reads them, so a demoted or blocked admin stops at once. */
  private async assertAdmin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isBlocked: true },
    });
    if (!user || user.role !== 'admin' || user.isBlocked)
      throw new ForbiddenException('Forbidden resource');
  }
}

function toRow(r: RawRow): AdminAuditRow {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    action: r.action,
    system: r.actorId === null,
    actor:
      r.actorName !== null && r.actorRole !== null
        ? { name: r.actorName, role: r.actorRole }
        : null,
    entityType: r.entityType,
    entityId: r.entityId,
  };
}

/** Midnight at the start of an Asia/Dhaka calendar day; a day that does not exist (2026-02-30) is refused. */
export function dhakaDayStart(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const utc = Date.UTC(y, m - 1, d);
  if (new Date(utc).toISOString().slice(0, 10) !== day) throw refuse('bad_date');
  return new Date(utc - DHAKA_OFFSET_MS);
}

export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url');
}

/** The cursor back to its parts; anything else is 400 bad_cursor (it is never trusted as SQL). */
export function decodeCursor(cursor: string): { ts: string; id: string } {
  const [ts, id, extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (extra !== undefined || !ts || !id || !TS_US.test(ts) || !UUID.test(id))
    throw refuse('bad_cursor');
  return { ts, id };
}

/** What the export's own audit row keeps: the action and dates as given, the actor only as a kind. */
function filterKinds(f: AdminAuditFilters): Record<string, string> {
  return {
    ...(f.action ? { action: f.action } : {}),
    ...(f.actor ? { actorKind: f.actor === 'system' ? 'system' : 'email' } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
  };
}
