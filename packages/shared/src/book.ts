/**
 * The free book after payment (owner, 2026-10-31; docs/plans/PAYMENTS-PLAN.md section 16). Shapes of
 * docs/06-API.md "Free book", shared by the API and the web.
 */
import type { PageQuery } from './dashboard';

export const BOOK_ORDER_STATUSES = ['confirmed', 'shipped'] as const;
export type BookOrderStatus = (typeof BOOK_ORDER_STATUSES)[number];

/** The order form's limits, as the API's DTO and the database CHECKs hold them. */
export const BOOK_ORDER_LIMITS = {
  recipientNameMax: 100,
  upazilaMin: 2,
  upazilaMax: 100,
  addressLineMin: 5,
  addressLineMax: 300,
  noteMax: 300,
  titleMax: 200,
} as const;

/** Cover upload limits (plan 16.5). */
export const BOOK_COVER_LIMITS = {
  maxBytes: 819_200,
  minSide: 100,
  maxSide: 4000,
  types: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

/** GET /book */
export interface BookInfo {
  title: string;
  /** Same-origin path of the current cover (`/api/book/cover/<id>`), or null before an admin uploads one. */
  coverUrl: string | null;
}

/** PUT /book-order/me */
export interface BookOrderInput {
  recipientName: string;
  recipientPhone: string;
  district: string;
  upazila: string;
  addressLine: string;
  note?: string;
  /** The version the form showed; a stale one is 409 (another tab changed it). Leave out on the first save. */
  expectedVersion?: number;
}

/** The student's own order (no ids: every student route is "me"). */
export interface MyBookOrderView {
  status: BookOrderStatus;
  recipientName: string;
  recipientPhone: string;
  district: string;
  upazila: string;
  addressLine: string;
  note: string | null;
  bookTitle: string;
  version: number;
  confirmedAt: string;
  shippedAt: string | null;
}

/** GET /book-order/me */
export interface MyBookOrder {
  /** True once the student has a (paid) registration. */
  eligible: boolean;
  order: MyBookOrderView | null;
}

/** GET /admin/book */
export interface AdminBookInfo {
  title: string;
  cover: {
    id: string;
    url: string;
    contentType: string;
    width: number;
    height: number;
    byteSize: number;
    uploadedAt: string;
  } | null;
  limits: typeof BOOK_COVER_LIMITS;
}

export interface AdminBookOrderQuery extends PageQuery {
  status?: BookOrderStatus;
  district?: string;
  /** Any Bangladeshi form; matches the recipient's or the student's phone. */
  phone?: string;
  email?: string;
}

export interface AdminBookOrderRow extends MyBookOrderView {
  id: string;
  /** Short code for the courier list (`B` + the end of the id). */
  code: string;
  student: { name: string; email: string; phone: string | null };
}
