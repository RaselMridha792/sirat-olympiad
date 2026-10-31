import {
  CATEGORIES,
  PAYMENT_STATUSES,
  ROLES,
  type AdminUserDetail,
  type AdminUserQuery,
  type AdminUserRegistration,
  type AdminUserRow,
  type Paginated,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, getJsonOrNull, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * The admin students list (core session; 06-API "Admin students list"). Each shape is checked and its fields
 * are picked one by one, so a field the API adds later never reaches the page.
 */

type Check = (value: unknown) => boolean;
const text: Check = (v) => typeof v === 'string';
const textOrNull: Check = (v) => v === null || typeof v === 'string';
const flag: Check = (v) => typeof v === 'boolean';
const count: Check = (v) => Number.isInteger(v);
const oneOf =
  (list: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && list.includes(v);
const orNull =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const shape =
  (fields: Record<string, Check>): Check =>
  (v) =>
    isRecord(v) && Object.entries(fields).every(([key, check]) => check(v[key]));

const registration = shape({
  registeredAt: text,
  invoiceNumber: text,
  paymentStatus: oneOf(PAYMENT_STATUSES),
  paidAt: textOrNull,
});

const ROW_FIELDS = {
  id: text,
  name: text,
  email: text,
  role: oneOf(ROLES),
  isBlocked: flag,
  category: orNull(oneOf(CATEGORIES)),
  district: textOrNull,
  createdAt: text,
  phoneLast3: textOrNull,
  gradeLabel: textOrNull,
  emailVerified: flag,
  registration: orNull(registration),
  needsPaymentReview: flag,
};
const isRow = shape(ROW_FIELDS) as (v: unknown) => v is AdminUserRow;

const isRowPage = (v: unknown): v is Paginated<AdminUserRow> =>
  isRecord(v) &&
  Array.isArray(v.items) &&
  v.items.every(isRow) &&
  count(v.page) &&
  count(v.pageSize) &&
  count(v.total);

const isDetail = shape({
  ...ROW_FIELDS,
  phone: textOrNull,
  institution: textOrNull,
  educationType: textOrNull,
  emailVerifiedAt: textOrNull,
  gradeLevel: orNull(shape({ id: text, label: text })),
  payment: orNull(
    shape({
      status: oneOf(PAYMENT_STATUSES),
      invoiceNumber: text,
      amountMinor: count,
      currency: text,
      paidAt: textOrNull,
    }),
  ),
  referredBy: orNull(shape({ name: text, promoCode: textOrNull })),
  ambassador: orNull(shape({ promoCode: text, approvedAt: textOrNull })),
}) as (v: unknown) => v is AdminUserDetail;

const pickRegistration = (r: AdminUserRegistration | null): AdminUserRegistration | null =>
  r && {
    registeredAt: r.registeredAt,
    invoiceNumber: r.invoiceNumber,
    paymentStatus: r.paymentStatus,
    paidAt: r.paidAt,
  };

const pickRow = (r: AdminUserRow): AdminUserRow => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  isBlocked: r.isBlocked,
  category: r.category,
  district: r.district,
  createdAt: r.createdAt,
  phoneLast3: r.phoneLast3,
  gradeLabel: r.gradeLabel,
  emailVerified: r.emailVerified,
  registration: pickRegistration(r.registration),
  needsPaymentReview: r.needsPaymentReview,
});

const pickDetail = (d: AdminUserDetail): AdminUserDetail => ({
  ...pickRow(d),
  phone: d.phone,
  institution: d.institution,
  educationType: d.educationType,
  emailVerifiedAt: d.emailVerifiedAt,
  gradeLevel: d.gradeLevel && { id: d.gradeLevel.id, label: d.gradeLevel.label },
  payment: d.payment && {
    status: d.payment.status,
    invoiceNumber: d.payment.invoiceNumber,
    amountMinor: d.payment.amountMinor,
    currency: d.payment.currency,
    paidAt: d.payment.paidAt,
  },
  referredBy: d.referredBy && { name: d.referredBy.name, promoCode: d.referredBy.promoCode },
  ambassador: d.ambassador && {
    promoCode: d.ambassador.promoCode,
    approvedAt: d.ambassador.approvedAt,
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The list's query string, the same parameters the page reads from its own URL. */
export function usersPath(query: AdminUserQuery): string {
  return withQuery('/admin/users', {
    page: query.page,
    pageSize: query.pageSize,
    q: query.q,
    role: query.role,
    blocked: query.blocked,
    category: query.category,
    registered: query.registered,
    verified: query.verified,
  });
}

export function adminUsers(get: ApiGet): Pick<DataSource['admin'], 'listUsers' | 'getUser'> {
  return {
    /** GET /admin/users (admin only; server paging and search). */
    async listUsers(query) {
      const page = await getJson(get, usersPath(query), isRowPage);
      return {
        items: page.items.map(pickRow),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    },
    /** GET /admin/users/:id (null = not found). */
    async getUser(id) {
      if (!UUID.test(id)) return null; // the API would answer 400; for the page it is simply not found
      const detail = await getJsonOrNull(get, `/admin/users/${encodeURIComponent(id)}`, isDetail);
      return detail && pickDetail(detail);
    },
  };
}
