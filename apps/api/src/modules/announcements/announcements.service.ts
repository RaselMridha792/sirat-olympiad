import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AdminAnnouncement,
  AnnouncementItem,
  AnnouncementRefusal,
  AnnouncementStatus,
  Category,
  Paginated,
} from '@sirat/shared';
import type Redis from 'ioredis';
import { withTimeout } from '../../common/with-timeout';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CACHE } from '../../redis/redis.module';
import type {
  AdminAnnouncementQueryDto,
  CreateAnnouncementDto,
  PageQueryDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

export interface Actor {
  id: string;
  ip: string | null;
}

type Tx = Prisma.TransactionClient;

const STUDENT_PAGE_SIZE = 10;
const ADMIN_PAGE_SIZE = 20;
/** A scheduled announcement appears at most this long after its time (the students' pages are cached). */
const CACHE_TTL_S = 60;
const REDIS_TIMEOUT_MS = 300;
const PUBLISH_PAST_GRACE_MS = 60_000;
/** Exported for the demo data's invalidation (demo-runner.ts). */
export const GENERATION_KEY = 'announcements:gen';

const refuse = (...codes: AnnouncementRefusal[]) => new ConflictException(codes);
const invalid = (...codes: AnnouncementRefusal[]) => new BadRequestException(codes);

const ROW = {
  id: true,
  title: true,
  body: true,
  category: true,
  publishedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
} satisfies Prisma.AnnouncementSelect;
type Row = Prisma.AnnouncementGetPayload<{ select: typeof ROW }>;

function statusOf(row: Pick<Row, 'archivedAt' | 'publishedAt'>, now: Date): AnnouncementStatus {
  if (row.archivedAt) return 'archived';
  return row.publishedAt > now ? 'scheduled' : 'published';
}

function toAdmin(row: Row, now: Date): AdminAnnouncement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    publishedAt: row.publishedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: statusOf(row, now),
    authorName: row.createdBy?.name ?? null,
  };
}

/** The status filter of the admin list as a condition on the stored columns. */
function statusWhere(
  status: AnnouncementStatus | undefined,
  now: Date,
): Prisma.AnnouncementWhereInput {
  if (status === 'archived') return { archivedAt: { not: null } };
  if (status === 'scheduled') return { archivedAt: null, publishedAt: { gt: now } };
  if (status === 'published') return { archivedAt: null, publishedAt: { lte: now } };
  return {};
}

/**
 * Announcements (06-API "Announcements"; core plan section 5): admins write them, students read the live ones for
 * everyone or their own category. The students' pages are cached in the cache Redis for 60 s; every admin write bumps
 * a generation number in the key, so a change shows at once. Redis trouble falls back to Postgres.
 */
@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);
  private lastWarnAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  // ───────────── students ─────────────

  async listForStudent(userId: string, query: PageQueryDto): Promise<Paginated<AnnouncementItem>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { category: true, isBlocked: true },
    });
    if (!user || user.isBlocked) throw new ForbiddenException(['account_blocked']);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? STUDENT_PAGE_SIZE;
    const generation = (await this.safe(() => this.redis.get(GENERATION_KEY))) ?? '0';
    const key = `announcements:v${generation ?? '0'}:${user.category ?? 'none'}:${page}:${pageSize}`;
    const cached = await this.safe(() => this.redis.get(key));
    if (cached) return JSON.parse(cached) as Paginated<AnnouncementItem>;

    const now = new Date();
    const where: Prisma.AnnouncementWhereInput = {
      archivedAt: null,
      publishedAt: { lte: now },
      OR: [{ category: null }, ...(user.category ? [{ category: user.category }] : [])],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, title: true, body: true, publishedAt: true },
      }),
    ]);
    const result: Paginated<AnnouncementItem> = {
      items: rows.map((r) => ({ ...r, publishedAt: r.publishedAt.toISOString() })),
      page,
      pageSize,
      total,
    };
    await this.safe(() => this.redis.set(key, JSON.stringify(result), 'EX', CACHE_TTL_S));
    return result;
  }

  // ───────────── admins ─────────────

  async list(
    query: AdminAnnouncementQueryDto,
    actor: Actor,
  ): Promise<Paginated<AdminAnnouncement>> {
    await assertAdmin(this.prisma, actor.id);
    const now = new Date();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? ADMIN_PAGE_SIZE;
    const where = statusWhere(query.status, now);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: ROW,
      }),
    ]);
    return { items: rows.map((r) => toAdmin(r, now)), page, pageSize, total };
  }

  async create(dto: CreateAnnouncementDto, actor: Actor): Promise<AdminAnnouncement> {
    const now = new Date();
    const publishedAt = publishTime(dto.publishAt, now);
    const row = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      const created = await tx.announcement.create({
        data: {
          title: dto.title,
          body: dto.body,
          category: dto.category,
          publishedAt,
          createdById: actor.id,
        },
        select: ROW,
      });
      await audit(tx, actor, 'announcement.created', created.id, {
        title: created.title,
        category: created.category,
        publishedAt: created.publishedAt.toISOString(),
      });
      return created;
    });
    await this.bumpGeneration();
    return toAdmin(row, now);
  }

  async update(id: string, dto: UpdateAnnouncementDto, actor: Actor): Promise<AdminAnnouncement> {
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      const current = await lock(tx, id, dto.expectedUpdatedAt);
      if (current.archivedAt) throw refuse('archived');
      const data: Prisma.AnnouncementUpdateInput = {};
      if (dto.title !== undefined && dto.title !== current.title) data.title = dto.title;
      if (dto.body !== undefined && dto.body !== current.body) data.body = dto.body;
      if (dto.category !== undefined && dto.category !== current.category)
        data.category = dto.category as Category | null;
      if (dto.publishAt !== undefined) {
        const at = publishTime(dto.publishAt, now);
        if (at.getTime() !== current.publishedAt.getTime()) data.publishedAt = at;
      }
      const fields = Object.keys(data);
      if (fields.length === 0) throw invalid('nothing_to_update');
      const updated = await tx.announcement.update({ where: { id }, data, select: ROW });
      await audit(tx, actor, 'announcement.updated', id, { title: updated.title, fields });
      return updated;
    });
    await this.bumpGeneration();
    return toAdmin(row, now);
  }

  async archive(id: string, expectedUpdatedAt: string, actor: Actor): Promise<AdminAnnouncement> {
    return this.setArchived(id, expectedUpdatedAt, actor, true);
  }

  async restore(id: string, expectedUpdatedAt: string, actor: Actor): Promise<AdminAnnouncement> {
    return this.setArchived(id, expectedUpdatedAt, actor, false);
  }

  private async setArchived(
    id: string,
    expectedUpdatedAt: string,
    actor: Actor,
    archived: boolean,
  ): Promise<AdminAnnouncement> {
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      await assertAdmin(tx, actor.id);
      const current = await lock(tx, id, expectedUpdatedAt);
      if (archived && current.archivedAt) throw refuse('archived');
      if (!archived && !current.archivedAt) throw refuse('not_archived');
      const updated = await tx.announcement.update({
        where: { id },
        data: { archivedAt: archived ? now : null },
        select: ROW,
      });
      await audit(tx, actor, archived ? 'announcement.archived' : 'announcement.restored', id, {
        title: updated.title,
      });
      return updated;
    });
    await this.bumpGeneration();
    return toAdmin(row, now);
  }

  /** After a commit: new cache keys for every students' page. A failure only delays the change by the TTL. */
  private async bumpGeneration(): Promise<void> {
    const done = await this.safe(() => this.redis.incr(GENERATION_KEY));
    if (done === undefined)
      this.logger.warn({ msg: 'announcements cache not invalidated', ttlSeconds: CACHE_TTL_S });
  }

  private async safe<T>(op: () => Promise<T>): Promise<T | undefined> {
    try {
      return await withTimeout(op(), REDIS_TIMEOUT_MS);
    } catch (e) {
      const now = Date.now();
      if (now - this.lastWarnAt >= 30_000) {
        this.lastWarnAt = now;
        this.logger.warn({
          msg: 'announcements cache unavailable, reading Postgres',
          errName: (e as Error).name,
        });
      }
      return undefined;
    }
  }
}

/** Now when absent; never more than a minute in the past (an announcement is not back-dated). */
function publishTime(value: string | undefined, now: Date): Date {
  if (value === undefined) return now;
  const at = new Date(value);
  if (at.getTime() < now.getTime() - PUBLISH_PAST_GRACE_MS) throw invalid('publish_in_past');
  return at;
}

/** Roles come from the token (15 min); every admin call re-reads them, so a demoted or blocked admin stops at once. */
async function assertAdmin(db: Tx | PrismaService, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isBlocked: true },
  });
  if (!user || user.role !== 'admin' || user.isBlocked)
    throw new ForbiddenException('Forbidden resource');
}

/** Locks the row for the rest of the transaction and checks it is the version the admin's form showed. */
async function lock(tx: Tx, id: string, expectedUpdatedAt: string) {
  await tx.$queryRaw`SELECT 1 FROM "announcements" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const row = await tx.announcement.findUnique({ where: { id } });
  if (!row) throw new NotFoundException('Announcement not found');
  if (row.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) throw refuse('stale');
  return row;
}

function audit(tx: Tx, actor: Actor, action: string, id: string, meta: Prisma.InputJsonValue) {
  return tx.auditLog.create({
    data: {
      action,
      actorId: actor.id,
      entityType: 'announcement',
      entityId: id,
      ip: actor.ip,
      meta,
    },
  });
}
