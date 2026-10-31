import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookOrderStatus, Prisma, type BookOrder } from '@prisma/client';
import {
  BOOK_COVER_LIMITS,
  type AdminBookInfo,
  type AdminBookOrderRow,
  type BookInfo,
  type MyBookOrder,
  type MyBookOrderView,
  type Paginated,
} from '@sirat/shared';
import { CSV_BOM, csvRow } from '../../common/csv';
import { PrismaService } from '../../prisma/prisma.service';
import { CoverRejected, prepareCover, type CoverProblem } from './book-image';
import type {
  AdminBookOrdersQueryDto,
  BookOrderDto,
  BookOrderFilterDto,
  BookTitleDto,
} from './book.dto';

export type Actor = { id: string; ip: string | null };

const TITLE_KEY = 'book_title';
const COVER_KEY = 'book_cover_image_id';
const coverUrl = (id: string) => `/api/book/cover/${id}`;
const EXPORT_BATCH = 500;

/** Short code for the courier list: `B` + the last 10 hex digits of the id (uuid7: its random part). */
export const orderCode = (id: string) => `B${id.replace(/-/g, '').slice(-10).toUpperCase()}`;

const error = (Type: new (body: object) => HttpException, code: string, message: string) =>
  new Type({ code, message });

const view = (o: BookOrder): MyBookOrderView => ({
  status: o.status,
  recipientName: o.recipientName,
  recipientPhone: o.recipientPhone,
  district: o.district,
  upazila: o.upazila,
  addressLine: o.addressLine,
  note: o.note,
  bookTitle: o.bookTitle,
  version: o.version,
  confirmedAt: o.confirmedAt.toISOString(),
  shippedAt: o.shippedAt?.toISOString() ?? null,
});

const ADMIN_ORDER = {
  include: { user: { select: { name: true, email: true, phone: true } } },
} as const;
type AdminOrder = Prisma.BookOrderGetPayload<typeof ADMIN_ORDER>;

/**
 * The free book (plan 16; owner B1–B5). A student orders one book for their own paid registration and may change
 * the address until an admin marks it shipped (the trigger book_orders_locked_after_shipping refuses it too). The
 * address, the recipient's phone and the note are personal data of a minor: only the student and admins see them,
 * and they never reach a log or an audit row (audit rows carry ids, counts and filters only).
 */
@Injectable()
export class BookService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────── shared ─────────────

  private async bookSettings(
    db: Pick<Prisma.TransactionClient, 'setting'> = this.prisma,
  ): Promise<{ title: string; coverImageId: string | null }> {
    const rows = await db.setting.findMany({ where: { key: { in: [TITLE_KEY, COVER_KEY] } } });
    const title = rows.find((r) => r.key === TITLE_KEY)?.value;
    const cover = rows.find((r) => r.key === COVER_KEY)?.value;
    return {
      title: typeof title === 'string' ? title : '',
      coverImageId: typeof cover === 'string' ? cover : null,
    };
  }

  async book(): Promise<BookInfo> {
    const { title, coverImageId } = await this.bookSettings();
    return { title, coverUrl: coverImageId ? coverUrl(coverImageId) : null };
  }

  /** Any stored cover (old ones stay: the audit trail points to them). */
  cover(id: string) {
    return this.prisma.bookImage.findUnique({
      where: { id },
      select: { data: true, contentType: true, byteSize: true },
    });
  }

  // ───────────── the student's own order ─────────────

  async myOrder(userId: string): Promise<MyBookOrder> {
    const [registration, order] = await Promise.all([
      this.prisma.registration.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.bookOrder.findUnique({ where: { userId } }),
    ]);
    return { eligible: registration !== null, order: order && view(order) };
  }

  /**
   * Creates the order or changes its address (owner B4, B5). The user comes from the session; the registration is
   * the user's own (the composite foreign key would refuse any other). Once shipped: 409. A stale expectedVersion
   * (another tab saved first): 409.
   */
  async saveMyOrder(userId: string, dto: BookOrderDto): Promise<MyBookOrderView> {
    const registration = await this.prisma.registration.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!registration)
      throw error(
        ForbiddenException,
        'BOOK_NOT_ELIGIBLE',
        'The book is available after your registration payment',
      );
    const fields = {
      recipientName: dto.recipientName,
      recipientPhone: dto.recipientPhone,
      district: dto.district,
      upazila: dto.upazila,
      addressLine: dto.addressLine,
      note: dto.note ?? null,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM book_orders WHERE user_id = ${userId}::uuid FOR UPDATE`;
        const existing = await tx.bookOrder.findUnique({ where: { userId } });
        if (!existing) {
          const { title } = await this.bookSettings(tx);
          const created = await tx.bookOrder.create({
            data: { userId, registrationId: registration.id, bookTitle: title, ...fields },
          });
          await tx.auditLog.create({
            data: {
              action: 'book_order.confirmed',
              actorId: userId,
              entityType: 'book_order',
              entityId: created.id,
            },
          });
          return view(created);
        }
        if (existing.status === BookOrderStatus.shipped)
          throw error(
            ConflictException,
            'BOOK_ORDER_SHIPPED',
            'The book has been shipped: the address can no longer change',
          );
        if (dto.expectedVersion !== undefined && dto.expectedVersion !== existing.version)
          throw error(
            ConflictException,
            'BOOK_ORDER_CHANGED',
            'The address was changed elsewhere. Reload and check.',
          );
        const updated = await tx.bookOrder.update({
          where: { id: existing.id },
          data: { ...fields, version: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            action: 'book_order.updated',
            actorId: userId,
            entityType: 'book_order',
            entityId: updated.id,
            meta: { version: updated.version },
          },
        });
        return view(updated);
      });
    } catch (e) {
      // Two first saves at once (two tabs): the second one meets UNIQUE(user_id).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw error(
          ConflictException,
          'BOOK_ORDER_CHANGED',
          'The address was changed elsewhere. Reload and check.',
        );
      throw e;
    }
  }

  // ───────────── admin: the book ─────────────

  async adminBook(): Promise<AdminBookInfo> {
    const { title, coverImageId } = await this.bookSettings();
    const image = coverImageId
      ? await this.prisma.bookImage.findUnique({
          where: { id: coverImageId },
          select: {
            id: true,
            contentType: true,
            width: true,
            height: true,
            byteSize: true,
            createdAt: true,
          },
        })
      : null;
    return {
      title,
      cover: image && {
        id: image.id,
        url: coverUrl(image.id),
        contentType: image.contentType,
        width: image.width,
        height: image.height,
        byteSize: image.byteSize,
        uploadedAt: image.createdAt.toISOString(),
      },
      limits: BOOK_COVER_LIMITS,
    };
  }

  /** The title for new orders (orders keep the title they were confirmed with, plan B7). */
  async setTitle(actor: Actor, dto: BookTitleDto): Promise<AdminBookInfo> {
    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ value: Prisma.JsonValue }[]>`
        SELECT value FROM settings WHERE key = ${TITLE_KEY} FOR UPDATE`;
      if (!row) throw new NotFoundException('Setting not found');
      if (row.value !== dto.expected)
        throw error(
          ConflictException,
          'SETTING_CHANGED',
          'This setting was changed by someone else. Reload and check.',
        );
      await tx.setting.update({ where: { key: TITLE_KEY }, data: { value: dto.title } });
      await tx.auditLog.create({
        data: {
          action: 'book.title_changed',
          actorId: actor.id,
          ip: actor.ip,
          entityType: 'setting',
          entityId: TITLE_KEY,
          meta: { old: row.value ?? null, new: dto.title, reason: dto.reason },
        },
      });
    });
    return this.adminBook();
  }

  /** Checks and strips the upload (book-image.ts), stores it once per content, and makes it the cover. */
  async setCover(actor: Actor, upload: Buffer | undefined): Promise<AdminBookInfo> {
    if (!upload) throw error(BadRequestException, 'COVER_MISSING', 'Choose an image file');
    let cover;
    try {
      cover = prepareCover(upload);
    } catch (e) {
      if (e instanceof CoverRejected) throw coverProblem(e.problem);
      throw e;
    }
    await this.prisma.$transaction(async (tx) => {
      const image =
        (await tx.bookImage.findUnique({
          where: { sha256: cover.sha256 },
          select: { id: true },
        })) ??
        (await tx.bookImage.create({
          data: {
            sha256: cover.sha256,
            contentType: cover.contentType,
            byteSize: cover.byteSize,
            width: cover.width,
            height: cover.height,
            data: new Uint8Array(cover.data), // Prisma Bytes wants a plain Uint8Array
            uploadedBy: actor.id,
          },
          select: { id: true },
        }));
      const [row] = await tx.$queryRaw<{ value: Prisma.JsonValue }[]>`
        SELECT value FROM settings WHERE key = ${COVER_KEY} FOR UPDATE`;
      if (!row) throw new NotFoundException('Setting not found');
      await tx.setting.update({ where: { key: COVER_KEY }, data: { value: image.id } });
      await tx.auditLog.create({
        data: {
          action: 'book.cover_changed',
          actorId: actor.id,
          ip: actor.ip,
          entityType: 'book_image',
          entityId: image.id,
          meta: {
            oldImageId: typeof row.value === 'string' ? row.value : null,
            newImageId: image.id,
            sha256: cover.sha256,
            byteSize: cover.byteSize,
            contentType: cover.contentType,
          },
        },
      });
    });
    return this.adminBook();
  }

  // ───────────── admin: the orders ─────────────

  private where(
    q: BookOrderFilterDto & { phone?: string; email?: string },
  ): Prisma.BookOrderWhereInput {
    const and: Prisma.BookOrderWhereInput[] = [];
    if (q.status) and.push({ status: q.status });
    if (q.district) and.push({ district: q.district });
    if (q.phone) and.push({ OR: [{ recipientPhone: q.phone }, { user: { phone: q.phone } }] });
    if (q.email) and.push({ user: { email: q.email } }); // citext: any case
    return and.length ? { AND: and } : {};
  }

  async listOrders(q: AdminBookOrdersQueryDto): Promise<Paginated<AdminBookOrderRow>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where = this.where(q);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bookOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        ...ADMIN_ORDER,
      }),
      this.prisma.bookOrder.count({ where }),
    ]);
    return { items: items.map(adminRow), page, pageSize, total };
  }

  /**
   * The courier list as CSV, written batch by batch (never held whole or stored): UTF-8 with a BOM, CRLF rows, cells
   * a spreadsheet would run as a formula made text (common/csv.ts). Returns the row count for the audit row.
   */
  async exportCsv(
    actor: Actor,
    q: BookOrderFilterDto,
    write: (chunk: string) => void,
  ): Promise<number> {
    write(CSV_BOM);
    write(
      csvRow([
        'Order',
        'Recipient',
        'Phone',
        'District',
        'Upazila/Thana',
        'Address',
        'Note',
        'Book',
      ]),
    );
    const where = this.where(q);
    let count = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.bookOrder.findMany({
        where,
        orderBy: { id: 'asc' },
        take: EXPORT_BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      for (const o of batch)
        write(
          csvRow([
            orderCode(o.id),
            o.recipientName,
            o.recipientPhone,
            o.district,
            o.upazila,
            o.addressLine,
            o.note,
            o.bookTitle,
          ]),
        );
      count += batch.length;
      if (batch.length < EXPORT_BATCH) break;
      cursor = batch[batch.length - 1]?.id;
    }
    await this.prisma.auditLog.create({
      data: {
        action: 'book_orders.exported',
        actorId: actor.id,
        ip: actor.ip,
        entityType: 'book_order',
        meta: { status: q.status ?? null, district: q.district ?? null, count },
      },
    });
    return count;
  }

  /** confirmed -> shipped; an order already shipped is left as it is. */
  async ship(actor: Actor, ids: string[], reason?: string): Promise<{ shipped: number }> {
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.bookOrder.findMany({
        where: { id: { in: ids }, status: BookOrderStatus.confirmed },
        select: { id: true },
      });
      const shippedIds = open.map((o) => o.id);
      if (shippedIds.length > 0)
        await tx.bookOrder.updateMany({
          where: { id: { in: shippedIds }, status: BookOrderStatus.confirmed },
          data: { status: BookOrderStatus.shipped, shippedAt: new Date(), shippedBy: actor.id },
        });
      await tx.auditLog.create({
        data: {
          action: 'book_orders.shipped',
          actorId: actor.id,
          ip: actor.ip,
          entityType: 'book_order',
          meta: { count: shippedIds.length, ids: shippedIds, ...(reason ? { reason } : {}) },
        },
      });
      return { shipped: shippedIds.length };
    });
  }
}

function adminRow(o: AdminOrder): AdminBookOrderRow {
  return {
    ...view(o),
    id: o.id,
    code: orderCode(o.id),
    student: { name: o.user.name, email: o.user.email, phone: o.user.phone },
  };
}

function coverProblem(problem: CoverProblem): HttpException {
  const texts: Record<CoverProblem, string> = {
    empty: 'The file is empty',
    too_large: 'The image is larger than 800 KB',
    unsupported_type: 'Only JPEG, PNG or WebP images',
    unreadable: 'The image file is damaged or not a supported image',
    bad_dimensions: 'Each side must be 100 to 4000 pixels',
  };
  const code = `COVER_${problem.toUpperCase()}`;
  return problem === 'too_large'
    ? new HttpException({ code, message: texts[problem] }, HttpStatus.PAYLOAD_TOO_LARGE)
    : new BadRequestException({ code, message: texts[problem] });
}
