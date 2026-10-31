import {
  ADMIN_SETTING_KEYS,
  PAYMENT_STATUSES,
  type AdminPaymentDetail,
  type AdminPaymentEvent,
  type AdminPaymentQuery,
  type AdminPaymentRow,
  type AdminSetting,
  type Paginated,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, getJsonOrNull, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * Admin payments and settings (payments PR 4; 06-API "Admin payments and settings"). Each shape is checked and its
 * fields are picked one by one, so a field the API adds later (the stored gateway answer of an event, for one)
 * never reaches the page.
 */

type Check = (value: unknown) => boolean;
const text: Check = (v) => typeof v === 'string';
const textOrNull: Check = (v) => v === null || typeof v === 'string';
const count: Check = (v) => Number.isInteger(v);
const countOrNull: Check = (v) => v === null || Number.isInteger(v);
const oneOf =
  (list: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && list.includes(v);
const shape =
  (fields: Record<string, Check>): Check =>
  (v) =>
    isRecord(v) && Object.entries(fields).every(([key, check]) => check(v[key]));

const isAttempt = shape({ status: text, email: text, phone: text, name: text });
const isRow = shape({
  id: text,
  invoiceNumber: text,
  amountMinor: count,
  currency: text,
  status: oneOf(PAYMENT_STATUSES),
  trxId: textOrNull,
  paidAmountMinor: countOrNull,
  gatewayStatus: textOrNull,
  gatewayAccount: text,
  reviewReason: textOrNull,
  checkCount: count,
  lastCheckedAt: textOrNull,
  expiresAt: text,
  paidAt: textOrNull,
  createdAt: text,
  userId: textOrNull,
  pendingRegistration: isAttempt,
});
const isRowPage = (v: unknown): v is Paginated<Raw> =>
  isRecord(v) &&
  Array.isArray(v.items) &&
  v.items.every(isRow) &&
  count(v.page) &&
  count(v.pageSize) &&
  count(v.total);
const isEvent = shape({
  id: text,
  source: text,
  outcome: text,
  statusCode: textOrNull,
  trxStatus: textOrNull,
  trxId: textOrNull,
  actorId: textOrNull,
  createdAt: text,
});
const isDetail = (v: unknown): v is { payment: Raw; events: Raw[] } =>
  isRecord(v) && isRow(v.payment) && Array.isArray(v.events) && v.events.every(isEvent);
const isSetting = shape({ key: oneOf(ADMIN_SETTING_KEYS), updatedAt: text });
type Raw = Record<string, unknown>;

const isSettingValue = (v: unknown) =>
  v === null || ['string', 'number', 'boolean'].includes(typeof v);
const isSettings = (v: unknown): v is Raw[] =>
  Array.isArray(v) &&
  v.every((s) => isSetting(s) && isSettingValue((s as { value: unknown }).value));

function pickRow(raw: unknown): AdminPaymentRow {
  const p = raw as Raw;
  const a = p.pendingRegistration as Raw;
  return {
    id: p.id as string,
    invoiceNumber: p.invoiceNumber as string,
    amountMinor: p.amountMinor as number,
    currency: p.currency as string,
    status: p.status as AdminPaymentRow['status'],
    trxId: p.trxId as string | null,
    paidAmountMinor: p.paidAmountMinor as number | null,
    gatewayStatus: p.gatewayStatus as string | null,
    gatewayAccount: p.gatewayAccount as string,
    reviewReason: p.reviewReason as string | null,
    checkCount: p.checkCount as number,
    lastCheckedAt: p.lastCheckedAt as string | null,
    expiresAt: p.expiresAt as string,
    paidAt: p.paidAt as string | null,
    createdAt: p.createdAt as string,
    userId: p.userId as string | null,
    attempt: {
      status: a.status as string,
      email: a.email as string,
      phone: a.phone as string,
      name: a.name as string,
    },
  };
}

function pickEvent(raw: unknown): AdminPaymentEvent {
  const e = raw as Raw;
  return {
    id: e.id as string,
    source: e.source as string,
    outcome: e.outcome as string,
    statusCode: e.statusCode as string | null,
    trxStatus: e.trxStatus as string | null,
    trxId: e.trxId as string | null,
    byAdmin: e.actorId !== null,
    createdAt: e.createdAt as string,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The API caps pageSize at 50. */
export function paymentsPath(query: AdminPaymentQuery): string {
  return withQuery('/admin/payments', {
    page: query.page,
    pageSize: Math.min(query.pageSize, 50),
    invoice: query.invoice,
    trx: query.trx,
    phone: query.phone,
    email: query.email,
    status: query.status,
    review: query.review ? '1' : undefined,
  });
}

export function adminPayments(
  get: ApiGet,
): Pick<DataSource['admin'], 'listPayments' | 'getPayment' | 'listSettings'> {
  return {
    async listPayments(query) {
      const page = await getJson(get, paymentsPath(query), isRowPage);
      return {
        items: page.items.map(pickRow),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    },
    async getPayment(id): Promise<AdminPaymentDetail | null> {
      if (!UUID.test(id)) return null; // the API would answer 400; for the page it is simply not found
      const detail = await getJsonOrNull(
        get,
        `/admin/payments/${encodeURIComponent(id)}`,
        isDetail,
      );
      return detail && { payment: pickRow(detail.payment), events: detail.events.map(pickEvent) };
    },
    async listSettings() {
      const rows = await getJson(get, '/admin/settings', isSettings);
      return rows.map((r): AdminSetting => ({
        key: r.key as AdminSetting['key'],
        value: r.value as AdminSetting['value'],
        updatedAt: r.updatedAt as string,
      }));
    },
  };
}
