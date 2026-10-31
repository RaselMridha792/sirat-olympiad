import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ADMIN_USER_EXPORT,
  normalizeBdMobile,
  type AdminUserDetail,
  type AdminUserFilters,
  type AdminUserRow,
  type Paginated,
} from '@sirat/shared';
import { errorLogFields } from '../../common/all-exceptions.filter';
import { CSV_BOM, csvRow, dhakaDateTime } from '../../common/csv';
import { PrismaService } from '../../prisma/prisma.service';

export interface Actor {
  id: string;
  ip: string | null;
}

const DEFAULT_PAGE_SIZE = 20;
const EXPORT_BATCH = 1_000;
/** Our invoice format (payments' CHECK `^[A-Z0-9]{10,20}$`), with at least one digit so a long name never matches. */
const INVOICE_SHAPE = /^(?=.*\d)[A-Z0-9]{10,20}$/;
/** Only students' data leaves the system (core plan D3); staff accounts are never exported. */
const EXPORTED_ROLES = ['student', 'ambassador'] as const;

export type SearchKind = 'phone' | 'invoice' | 'email' | 'name';

/** What a search term looks like; the export's audit row keeps this, never the term itself. */
export function searchKind(q: string): SearchKind {
  if (normalizeBdMobile(q)) return 'phone';
  if (INVOICE_SHAPE.test(q.toUpperCase())) return 'invoice';
  return q.includes('@') ? 'email' : 'name';
}

/** The list filters as one Prisma condition (06-API "Admin students list"). */
export function userWhere(f: AdminUserFilters): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [];
  if (f.role) and.push({ role: f.role });
  if (f.blocked !== undefined) and.push({ isBlocked: f.blocked });
  if (f.category) and.push({ category: f.category });
  if (f.registered !== undefined)
    and.push({ registration: f.registered ? { isNot: null } : { is: null } });
  if (f.verified !== undefined)
    and.push({ emailVerifiedAt: f.verified ? { not: null } : { equals: null } });
  if (f.q) {
    const or: Prisma.UserWhereInput[] = [
      { name: { contains: f.q, mode: 'insensitive' } },
      { email: { contains: f.q, mode: 'insensitive' } },
    ];
    const phone = normalizeBdMobile(f.q);
    if (phone) or.push({ phone });
    const invoice = f.q.toUpperCase();
    if (INVOICE_SHAPE.test(invoice))
      or.push({ registration: { is: { payment: { invoiceNumber: invoice } } } });
    and.push({ OR: or });
  }
  return and.length ? { AND: and } : {};
}

const ROW_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isBlocked: true,
  category: true,
  district: true,
  phone: true,
  emailVerifiedAt: true,
  createdAt: true,
  gradeLevel: { select: { id: true, label: true } },
  registration: {
    select: {
      createdAt: true,
      payment: {
        select: {
          invoiceNumber: true,
          status: true,
          paidAt: true,
          amountMinor: true,
          currency: true,
        },
      },
    },
  },
  // Any payment of this user an operator must look at (duplicate, refund reported, ...): one id is enough.
  payments: { where: { reviewReason: { not: null } }, select: { id: true }, take: 1 },
} satisfies Prisma.UserSelect;

type RowData = Prisma.UserGetPayload<{ select: typeof ROW_SELECT }>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toRow(u: RowData): AdminUserRow {
  const reg = u.registration;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isBlocked: u.isBlocked,
    category: u.category,
    district: u.district,
    createdAt: u.createdAt.toISOString(),
    phoneLast3: u.phone ? u.phone.slice(-3) : null,
    gradeLabel: u.gradeLevel?.label ?? null,
    emailVerified: u.emailVerifiedAt !== null,
    registration: reg
      ? {
          registeredAt: reg.createdAt.toISOString(),
          invoiceNumber: reg.payment.invoiceNumber,
          paymentStatus: reg.payment.status,
          paidAt: iso(reg.payment.paidAt),
        }
      : null,
    needsPaymentReview: u.payments.length > 0,
  };
}

const DETAIL_SELECT = {
  ...ROW_SELECT,
  institution: true,
  educationType: true,
  referredBy: { select: { name: true, ambassador: { select: { promoCode: true } } } },
  ambassador: { select: { promoCode: true, approvedAt: true } },
} satisfies Prisma.UserSelect;

const EXPORT_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  district: true,
  institution: true,
  educationType: true,
  category: true,
  role: true,
  isBlocked: true,
  emailVerifiedAt: true,
  createdAt: true,
  gradeLevel: { select: { label: true } },
  registration: ROW_SELECT.registration,
  referredBy: { select: { ambassador: { select: { promoCode: true } } } },
} satisfies Prisma.UserSelect;

type ExportData = Prisma.UserGetPayload<{ select: typeof EXPORT_SELECT }>;

export const EXPORT_COLUMNS = [
  'user_id',
  'name',
  'email',
  'phone',
  'district',
  'institution',
  'education_type',
  'grade_level',
  'category',
  'role',
  'blocked',
  'email_verified',
  'registered_at',
  'invoice',
  'amount_bdt',
  'payment_status',
  'paid_at',
  'referrer_promo_code',
] as const;

function exportRow(u: ExportData): string {
  const pay = u.registration?.payment ?? null;
  return csvRow([
    u.id,
    u.name,
    u.email,
    u.phone,
    u.district,
    u.institution,
    u.educationType,
    u.gradeLevel?.label,
    u.category,
    u.role,
    u.isBlocked ? 'yes' : 'no',
    u.emailVerifiedAt ? 'yes' : 'no',
    dhakaDateTime(u.registration?.createdAt),
    pay?.invoiceNumber,
    pay ? pay.amountMinor / 100 : null, // whole taka by CHECK
    pay?.status,
    dhakaDateTime(pay?.paidAt),
    u.referredBy?.ambassador?.promoCode,
  ]);
}

export interface UsersExport {
  rowCount: number;
  filename: string;
  chunks: AsyncIterable<string>;
}

/** The admin students list: read only, admins only (06-API "Admin students list"; core plan section 2). */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: AdminUserFilters & { page?: number; pageSize?: number },
    actor: Actor,
  ): Promise<Paginated<AdminUserRow>> {
    await this.assertAdmin(actor.id);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where = userWhere(query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: ROW_SELECT,
      }),
    ]);
    return { items: rows.map(toRow), page, pageSize, total };
  }

  async get(id: string, actor: Actor): Promise<AdminUserDetail> {
    await this.assertAdmin(actor.id);
    const u = await this.prisma.user.findUnique({ where: { id }, select: DETAIL_SELECT });
    if (!u) throw new NotFoundException('User not found');
    const pay = u.registration?.payment ?? null;
    return {
      ...toRow(u),
      phone: u.phone,
      institution: u.institution,
      educationType: u.educationType,
      emailVerifiedAt: iso(u.emailVerifiedAt),
      gradeLevel: u.gradeLevel,
      payment: pay
        ? {
            status: pay.status,
            invoiceNumber: pay.invoiceNumber,
            amountMinor: pay.amountMinor,
            currency: pay.currency,
            paidAt: iso(pay.paidAt),
          }
        : null,
      referredBy: u.referredBy
        ? { name: u.referredBy.name, promoCode: u.referredBy.ambassador?.promoCode ?? null }
        : null,
      ambassador: u.ambassador
        ? { promoCode: u.ambassador.promoCode, approvedAt: iso(u.ambassador.approvedAt) }
        : null,
    };
  }

  /**
   * Counts the rows, writes the audit row, then streams the CSV in keyset batches. Without its audit row nothing
   * is exported: the data of minors leaves the system only on the record (RULEBOOK §15).
   */
  async export(filters: AdminUserFilters, reason: string, actor: Actor): Promise<UsersExport> {
    await this.assertAdmin(actor.id);
    const where: Prisma.UserWhereInput = {
      AND: [userWhere(filters), { role: { in: [...EXPORTED_ROLES] } }],
    };
    const rowCount = await this.prisma.user.count({ where });
    if (rowCount > ADMIN_USER_EXPORT.maxRows) throw new BadRequestException(['too_many_rows']);
    const { q, ...rest } = filters;
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'users.exported',
          actorId: actor.id,
          entityType: 'user',
          ip: actor.ip,
          meta: {
            filters: { ...rest, ...(q ? { qKind: searchKind(q) } : {}) },
            rowCount,
            reason,
          },
        },
      });
    } catch (e) {
      this.logger.error({ msg: 'export audit write failed', ...errorLogFields(e) });
      throw new ServiceUnavailableException('The export could not be recorded. Try again.');
    }
    const stamp = dhakaDateTime(new Date()).replace(/[-: ]/g, '').slice(0, 12);
    return { rowCount, filename: `students-${stamp}.csv`, chunks: this.rows(where) };
  }

  private async *rows(where: Prisma.UserWhereInput): AsyncGenerator<string> {
    yield CSV_BOM + csvRow(EXPORT_COLUMNS);
    let after: { createdAt: Date; id: string } | null = null;
    for (;;) {
      const batch: ExportData[] = await this.prisma.user.findMany({
        where: after
          ? {
              AND: [
                where,
                {
                  OR: [
                    { createdAt: { lt: after.createdAt } },
                    { createdAt: after.createdAt, id: { lt: after.id } },
                  ],
                },
              ],
            }
          : where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: EXPORT_BATCH,
        select: EXPORT_SELECT,
      });
      if (batch.length === 0) return;
      yield batch.map(exportRow).join('');
      if (batch.length < EXPORT_BATCH) return;
      const last = batch[batch.length - 1]!;
      after = { createdAt: last.createdAt, id: last.id };
    }
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
