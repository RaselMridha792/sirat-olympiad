import {
  BOOK_ORDER_STATUSES,
  type AdminBookInfo,
  type AdminBookOrderQuery,
  type AdminBookOrderRow,
  type BookInfo,
  type MyBookOrder,
  type MyBookOrderView,
  type Paginated,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * The free book (payments PR 6b; 06-API "Free book"). Each shape is checked and its fields are picked one by one, so
 * a field the API adds later never reaches the page. The student's own order holds their address: it reaches only
 * the student's own page (the API takes the user from the session).
 */

type Check = (value: unknown) => boolean;
const text: Check = (v) => typeof v === 'string';
const textOrNull: Check = (v) => v === null || typeof v === 'string';
const count: Check = (v) => Number.isInteger(v);
const flag: Check = (v) => typeof v === 'boolean';
const oneOf =
  (list: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && list.includes(v);
const shape =
  (fields: Record<string, Check>): Check =>
  (v) =>
    isRecord(v) && Object.entries(fields).every(([key, check]) => check(v[key]));
type Raw = Record<string, unknown>;

const ORDER_FIELDS = {
  status: oneOf(BOOK_ORDER_STATUSES),
  recipientName: text,
  recipientPhone: text,
  district: text,
  upazila: text,
  addressLine: text,
  note: textOrNull,
  bookTitle: text,
  version: count,
  confirmedAt: text,
  shippedAt: textOrNull,
};
const isOrder = shape(ORDER_FIELDS);
/** Covers are same-origin paths only: a page never loads an image from elsewhere. */
const coverPath: Check = (v) =>
  v === null || (typeof v === 'string' && /^\/api\/book\/cover\/[0-9a-f-]{36}$/.test(v));

const isBook = (v: unknown): v is Raw => shape({ title: text, coverUrl: coverPath })(v);
const isMyOrder = (v: unknown): v is Raw =>
  isRecord(v) && flag(v.eligible) && (v.order === null || isOrder(v.order));
const isAdminBook = (v: unknown): v is Raw =>
  isRecord(v) &&
  text(v.title) &&
  isRecord(v.limits) &&
  (v.cover === null ||
    shape({
      id: text,
      url: coverPath,
      contentType: text,
      width: count,
      height: count,
      byteSize: count,
      uploadedAt: text,
    })(v.cover));
const isRow = shape({
  ...ORDER_FIELDS,
  id: text,
  code: text,
  student: shape({ name: text, email: text, phone: textOrNull }),
});
const isRowPage = (v: unknown): v is Paginated<Raw> =>
  isRecord(v) &&
  Array.isArray(v.items) &&
  v.items.every(isRow) &&
  count(v.page) &&
  count(v.pageSize) &&
  count(v.total);

function pickOrder(raw: unknown): MyBookOrderView {
  const o = raw as Raw;
  return {
    status: o.status as MyBookOrderView['status'],
    recipientName: o.recipientName as string,
    recipientPhone: o.recipientPhone as string,
    district: o.district as string,
    upazila: o.upazila as string,
    addressLine: o.addressLine as string,
    note: o.note as string | null,
    bookTitle: o.bookTitle as string,
    version: o.version as number,
    confirmedAt: o.confirmedAt as string,
    shippedAt: o.shippedAt as string | null,
  };
}

function pickRow(raw: unknown): AdminBookOrderRow {
  const r = raw as Raw;
  const s = r.student as Raw;
  return {
    ...pickOrder(r),
    id: r.id as string,
    code: r.code as string,
    student: { name: s.name as string, email: s.email as string, phone: s.phone as string | null },
  };
}

/** The API caps pageSize at 100. */
export function bookOrdersPath(query: AdminBookOrderQuery): string {
  return withQuery('/admin/book-orders', {
    page: query.page,
    pageSize: Math.min(query.pageSize, 100),
    status: query.status,
    district: query.district,
    phone: query.phone,
    email: query.email,
  });
}

export function studentBook(get: ApiGet): Pick<DataSource['student'], 'getBook' | 'getBookOrder'> {
  return {
    async getBook(): Promise<BookInfo> {
      const b = await getJson(get, '/book', isBook);
      return { title: b.title as string, coverUrl: b.coverUrl as string | null };
    },
    async getBookOrder(): Promise<MyBookOrder> {
      const m = await getJson(get, '/book-order/me', isMyOrder);
      return {
        eligible: m.eligible as boolean,
        order: m.order === null ? null : pickOrder(m.order),
      };
    },
  };
}

export function adminBook(get: ApiGet): Pick<DataSource['admin'], 'getBook' | 'listBookOrders'> {
  return {
    async getBook(): Promise<AdminBookInfo> {
      const b = await getJson(get, '/admin/book', isAdminBook);
      const c = b.cover as Raw | null;
      const l = b.limits as Raw;
      return {
        title: b.title as string,
        cover: c && {
          id: c.id as string,
          url: c.url as string,
          contentType: c.contentType as string,
          width: c.width as number,
          height: c.height as number,
          byteSize: c.byteSize as number,
          uploadedAt: c.uploadedAt as string,
        },
        limits: l as AdminBookInfo['limits'],
      };
    },
    async listBookOrders(query) {
      const page = await getJson(get, bookOrdersPath(query), isRowPage);
      return {
        items: page.items.map(pickRow),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    },
  };
}
