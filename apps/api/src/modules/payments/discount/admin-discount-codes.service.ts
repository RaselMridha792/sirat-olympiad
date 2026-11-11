import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Prisma, type DiscountCode } from '@prisma/client';
import {
  isDiscountCodeFormat,
  type AdminDiscountCode,
  type AdminDiscountCodeUses,
  type Paginated,
} from '@sirat/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type {
  AdminDiscountCodesQueryDto,
  CreateDiscountCodeDto,
  UpdateDiscountCodeDto,
} from './admin-discount-codes.dto';
import { usesOf } from './discount-pricing';

export type DiscountActor = { id: string; ip: string | null };

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GENERATE_ATTEMPTS = 5;

/** DC- + 8 Crockford characters from a strong random source (40 bits): what "Generate" makes. */
export const generateDiscountCode = (): string =>
  `DC-${Array.from({ length: 8 }, () => CROCKFORD[randomInt(32)]).join('')}`;

const WITH_AMBASSADOR = {
  ambassador: { select: { id: true, name: true, ambassador: { select: { promoCode: true } } } },
} satisfies Prisma.DiscountCodeInclude;
type CodeRow = Prisma.DiscountCodeGetPayload<{ include: typeof WITH_AMBASSADOR }>;

const bad = (code: string, message: string) => new BadRequestException({ code, message });
const conflict = (code: string, message: string) => new ConflictException({ code, message });

/**
 * Admin discount codes (DECISIONS "Discount codes"; payments D1). Admin only: codes change what a registration costs.
 * Every write is audited with what changed. Kind, value and the linked ambassador lock after the first paid use, so
 * a use's discount always matches its code (the payment keeps its own snapshot anyway); a used code is never deleted,
 * only switched off. Demo codes (the demo loader's) are read only here.
 */
@Injectable()
export class AdminDiscountCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    q: AdminDiscountCodesQueryDto,
    now = new Date(),
  ): Promise<Paginated<AdminDiscountCode>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where: Prisma.DiscountCodeWhereInput = {
      ...(q.q ? { code: { contains: q.q, mode: 'insensitive' } } : {}),
      ...(q.linked ? { ambassadorUserId: { not: null } } : {}),
      ...(q.status === 'inactive' ? { active: false } : {}),
      ...(q.status === 'expired' ? { endsAt: { lte: now } } : {}),
      ...(q.status === 'scheduled' ? { startsAt: { gt: now } } : {}),
      ...(q.status === 'active'
        ? {
            active: true,
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
              { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.discountCode.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: WITH_AMBASSADOR,
      }),
      this.prisma.discountCode.count({ where }),
    ]);
    const uses = await this.usesFor(
      rows.map((r) => r.id),
      now,
    );
    return {
      items: rows.map((r) => view(r, uses.get(r.id) ?? { paid: 0, live: 0 })),
      page,
      pageSize,
      total,
    };
  }

  async get(id: string, now = new Date()): Promise<AdminDiscountCode> {
    const row = await this.prisma.discountCode.findUnique({
      where: { id },
      include: WITH_AMBASSADOR,
    });
    if (!row) throw new NotFoundException('Discount code not found');
    return view(row, await usesOf(this.prisma, id, now));
  }

  async create(actor: DiscountActor, dto: CreateDiscountCodeDto): Promise<AdminDiscountCode> {
    checkValue(dto.kind, dto.value);
    checkWindow(dto.startsAt ?? null, dto.endsAt ?? null);
    if (dto.ambassadorUserId) await this.checkAmbassador(dto.ambassadorUserId);
    const generated = !dto.code;
    for (let i = 0; ; i++) {
      const code = dto.code ?? generateDiscountCode();
      if (!isDiscountCodeFormat(code))
        throw bad(
          'CODE_INVALID',
          'A code has 4 to 20 letters, digits or "-", and never starts with SR- or TM-',
        );
      if (await this.prisma.ambassadorProfile.findUnique({ where: { promoCode: code } }))
        throw conflict('CODE_TAKEN', 'An ambassador already has this code');
      try {
        const row = await this.prisma.$transaction(async (tx) => {
          const created = await tx.discountCode.create({
            data: {
              code,
              kind: dto.kind,
              value: dto.value,
              maxUses: dto.maxUses ?? null,
              startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
              endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
              active: dto.active ?? true,
              ambassadorUserId: dto.ambassadorUserId ?? null,
              note: dto.note ?? null,
              createdById: actor.id,
            },
            include: WITH_AMBASSADOR,
          });
          await tx.auditLog.create({
            data: {
              action: 'discount_codes.created',
              actorId: actor.id,
              ip: actor.ip,
              entityType: 'discount_code',
              entityId: created.id,
              meta: { ...auditable(created), generated },
            },
          });
          return created;
        });
        return view(row, { paid: 0, live: 0 });
      } catch (e) {
        const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!clash) throw e;
        if (!generated) throw conflict('CODE_TAKEN', 'This code already exists');
        if (i + 1 >= GENERATE_ATTEMPTS) throw e;
      }
    }
  }

  async update(
    actor: DiscountActor,
    id: string,
    dto: UpdateDiscountCodeDto,
    now = new Date(),
  ): Promise<AdminDiscountCode> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "discount_codes" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const before = await tx.discountCode.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Discount code not found');
      if (before.demoBatchId)
        throw conflict('DEMO_CODE', 'Demo codes are removed with the demo data');
      const next = {
        kind: dto.kind ?? before.kind,
        value: dto.value ?? before.value,
        ambassadorUserId:
          dto.ambassadorUserId === undefined ? before.ambassadorUserId : dto.ambassadorUserId,
        maxUses: dto.maxUses === undefined ? before.maxUses : dto.maxUses,
        startsAt:
          dto.startsAt === undefined
            ? before.startsAt
            : dto.startsAt
              ? new Date(dto.startsAt)
              : null,
        endsAt: dto.endsAt === undefined ? before.endsAt : dto.endsAt ? new Date(dto.endsAt) : null,
        active: dto.active ?? before.active,
        note: dto.note === undefined ? before.note : dto.note,
      };
      const lockedChange =
        next.kind !== before.kind ||
        next.value !== before.value ||
        next.ambassadorUserId !== before.ambassadorUserId;
      if (lockedChange && (await usesOf(tx, id, now)).paid > 0)
        throw conflict(
          'CODE_LOCKED',
          'This code has been used: its kind, value and ambassador can no longer change. Make a new code.',
        );
      checkValue(next.kind, next.value);
      checkWindow(next.startsAt?.toISOString() ?? null, next.endsAt?.toISOString() ?? null);
      if (next.ambassadorUserId && next.ambassadorUserId !== before.ambassadorUserId)
        await this.checkAmbassador(next.ambassadorUserId, tx);
      const after = await tx.discountCode.update({
        where: { id },
        data: next,
        include: WITH_AMBASSADOR,
      });
      const changed = changes(auditable(before), auditable(after));
      if (Object.keys(changed).length > 0)
        await tx.auditLog.create({
          data: {
            action: 'discount_codes.updated',
            actorId: actor.id,
            ip: actor.ip,
            entityType: 'discount_code',
            entityId: id,
            meta: { code: after.code, changed } as Prisma.InputJsonValue,
          },
        });
      return after;
    });
    return view(row, await usesOf(this.prisma, id, now));
  }

  /** Only a code nobody has started a registration with; a used one is switched off instead. */
  async remove(actor: DiscountActor, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "discount_codes" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const row = await tx.discountCode.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Discount code not found');
      if (row.demoBatchId) throw conflict('DEMO_CODE', 'Demo codes are removed with the demo data');
      const used =
        (await tx.payment.count({ where: { discountCodeId: id } })) +
        (await tx.pendingRegistration.count({ where: { discountCodeId: id } }));
      if (used > 0)
        throw conflict(
          'CODE_IN_USE',
          'This code has been used. Switch it off instead of deleting it.',
        );
      await tx.discountCode.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          action: 'discount_codes.deleted',
          actorId: actor.id,
          ip: actor.ip,
          entityType: 'discount_code',
          entityId: id,
          meta: auditable(row),
        },
      });
    });
  }

  /** The paid uses, newest first, with the totals over all of them. */
  async uses(id: string, page = 1, pageSize = 20): Promise<AdminDiscountCodeUses> {
    if (!(await this.prisma.discountCode.findUnique({ where: { id }, select: { id: true } })))
      throw new NotFoundException('Discount code not found');
    const where: Prisma.PaymentWhereInput = { discountCodeId: id, status: PaymentStatus.paid };
    const [rows, total, sums] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          invoiceNumber: true,
          userId: true,
          paidAt: true,
          listAmountMinor: true,
          discountMinor: true,
          amountMinor: true,
          user: { select: { name: true } },
          registration: { select: { participantId: true } },
        },
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({ where, _sum: { discountMinor: true, amountMinor: true } }),
    ]);
    return {
      items: rows.map((r) => ({
        paymentId: r.id,
        invoiceNumber: r.invoiceNumber,
        userId: r.userId,
        name: r.user?.name ?? null,
        participantId: r.registration?.participantId ?? null,
        paidAt: r.paidAt?.toISOString() ?? null,
        listAmountMinor: r.listAmountMinor ?? r.amountMinor,
        discountMinor: r.discountMinor,
        amountMinor: r.amountMinor,
      })),
      page,
      pageSize,
      total,
      totals: {
        uses: total,
        discountMinor: sums._sum.discountMinor ?? 0,
        collectedMinor: sums._sum.amountMinor ?? 0,
      },
    };
  }

  /** An approved ambassador on the real side: a real code never links a demo account (demo_clear would refuse). */
  private async checkAmbassador(userId: string, db: Prisma.TransactionClient = this.prisma) {
    const profile = await db.ambassadorProfile.findFirst({
      where: { userId, approvedAt: { not: null }, user: { demoBatchId: null } },
      select: { userId: true },
    });
    if (!profile)
      throw bad('AMBASSADOR_INVALID', 'Link an approved ambassador, or leave the field empty');
  }

  private async usesFor(ids: string[], now: Date) {
    const out = new Map<string, { paid: number; live: number }>();
    if (ids.length === 0) return out;
    const [paid, live] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['discountCodeId'],
        where: { discountCodeId: { in: ids }, status: PaymentStatus.paid },
        _count: { _all: true },
      }),
      this.prisma.payment.groupBy({
        by: ['discountCodeId'],
        where: {
          discountCodeId: { in: ids },
          status: { in: [PaymentStatus.initiated, PaymentStatus.pending] },
          expiresAt: { gt: now },
        },
        _count: { _all: true },
      }),
    ]);
    for (const id of ids) out.set(id, { paid: 0, live: 0 });
    for (const p of paid) out.get(p.discountCodeId as string)!.paid = p._count._all;
    for (const l of live) out.get(l.discountCodeId as string)!.live = l._count._all;
    return out;
  }
}

function checkValue(kind: string, value: number) {
  if (kind === 'percent' && (value < 1 || value > 99))
    throw bad('VALUE_INVALID', 'A percentage is 1 to 99');
  if (kind === 'amount' && (value < 100 || value % 100 !== 0))
    throw bad('VALUE_INVALID', 'An amount is whole taka');
}

function checkWindow(startsAt: string | null, endsAt: string | null) {
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt))
    throw bad('WINDOW_INVALID', 'The end must come after the start');
}

/** What the audit records about a code (no personal data). */
function auditable(c: DiscountCode) {
  return {
    code: c.code,
    kind: c.kind,
    value: c.value,
    maxUses: c.maxUses,
    startsAt: c.startsAt?.toISOString() ?? null,
    endsAt: c.endsAt?.toISOString() ?? null,
    active: c.active,
    ambassadorUserId: c.ambassadorUserId,
    note: c.note,
  };
}

function changes<T extends Record<string, unknown>>(before: T, after: T) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after))
    if (before[key] !== after[key]) out[key] = { from: before[key], to: after[key] };
  return out;
}

function view(r: CodeRow, uses: { paid: number; live: number }): AdminDiscountCode {
  return {
    id: r.id,
    code: r.code,
    kind: r.kind,
    value: r.value,
    maxUses: r.maxUses,
    startsAt: r.startsAt?.toISOString() ?? null,
    endsAt: r.endsAt?.toISOString() ?? null,
    active: r.active,
    note: r.note,
    ambassador: r.ambassador
      ? {
          userId: r.ambassador.id,
          name: r.ambassador.name,
          promoCode: r.ambassador.ambassador?.promoCode ?? null,
        }
      : null,
    uses,
    locked: uses.paid > 0,
    demo: r.demoBatchId !== null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
