import {
  DISCOUNT_CODE_STATUSES,
  DISCOUNT_KINDS,
  MASKED_PARTICIPANT_ID_PATTERN,
  type AdminDiscountCode,
  type AdminDiscountCodeQuery,
  type AdminDiscountCodeUse,
  type AdminDiscountCodeUses,
  type Paginated,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, getJsonOrNull, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * Admin discount codes (payments D1/D2; 06-API "Admin discount codes"). Each shape is checked and its fields are picked
 * one by one, so a field the API adds later never reaches the page.
 */

type Check = (value: unknown) => boolean;
type Raw = Record<string, unknown>;
const text: Check = (v) => typeof v === 'string';
const textOrNull: Check = (v) => v === null || typeof v === 'string';
const count: Check = (v) => Number.isInteger(v) && (v as number) >= 0;
const countOrNull: Check = (v) => v === null || count(v);
const bool: Check = (v) => typeof v === 'boolean';
const oneOf =
  (list: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && list.includes(v);
const shape =
  (fields: Record<string, Check>): Check =>
  (v) =>
    isRecord(v) && Object.entries(fields).every(([key, check]) => check(v[key]));

const isAmbassador = (v: unknown) =>
  v === null || shape({ userId: text, name: text, promoCode: textOrNull })(v);
const isCode = shape({
  id: text,
  code: text,
  kind: oneOf(DISCOUNT_KINDS),
  value: count,
  maxUses: countOrNull,
  startsAt: textOrNull,
  endsAt: textOrNull,
  active: bool,
  note: textOrNull,
  ambassador: isAmbassador,
  uses: shape({ paid: count, live: count }),
  locked: bool,
  status: oneOf(DISCOUNT_CODE_STATUSES),
  demo: bool,
  createdAt: text,
  updatedAt: text,
});
const isCodeRow = (v: unknown): v is Raw => isCode(v);
const isCodePage = (v: unknown): v is Paginated<Raw> =>
  isRecord(v) &&
  Array.isArray(v.items) &&
  v.items.every(isCode) &&
  count(v.page) &&
  count(v.pageSize) &&
  count(v.total);
const isUse = shape({
  paymentId: text,
  invoiceNumber: text,
  userId: textOrNull,
  name: textOrNull,
  // Only the masked form is accepted: a full ID here would be a login on an admin page.
  participantIdMasked: (v) =>
    v === null || (typeof v === 'string' && MASKED_PARTICIPANT_ID_PATTERN.test(v)),
  paidAt: textOrNull,
  listAmountMinor: count,
  discountMinor: count,
  amountMinor: count,
});
const isUses = (v: unknown): v is Raw =>
  isRecord(v) &&
  Array.isArray(v.items) &&
  v.items.every(isUse) &&
  count(v.page) &&
  count(v.pageSize) &&
  count(v.total) &&
  shape({ uses: count, discountMinor: count, collectedMinor: count })(v.totals);

export function pickCode(raw: unknown): AdminDiscountCode {
  const c = raw as Raw;
  const a = c.ambassador as Raw | null;
  const uses = c.uses as Raw;
  return {
    id: c.id as string,
    code: c.code as string,
    kind: c.kind as AdminDiscountCode['kind'],
    value: c.value as number,
    maxUses: c.maxUses as number | null,
    startsAt: c.startsAt as string | null,
    endsAt: c.endsAt as string | null,
    active: c.active as boolean,
    note: c.note as string | null,
    ambassador: a
      ? {
          userId: a.userId as string,
          name: a.name as string,
          promoCode: a.promoCode as string | null,
        }
      : null,
    uses: { paid: uses.paid as number, live: uses.live as number },
    locked: c.locked as boolean,
    status: c.status as AdminDiscountCode['status'],
    demo: c.demo as boolean,
    createdAt: c.createdAt as string,
    updatedAt: c.updatedAt as string,
  };
}

function pickUse(raw: unknown): AdminDiscountCodeUse {
  const u = raw as Raw;
  return {
    paymentId: u.paymentId as string,
    invoiceNumber: u.invoiceNumber as string,
    userId: u.userId as string | null,
    name: u.name as string | null,
    participantIdMasked: u.participantIdMasked as string | null,
    paidAt: u.paidAt as string | null,
    listAmountMinor: u.listAmountMinor as number,
    discountMinor: u.discountMinor as number,
    amountMinor: u.amountMinor as number,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The API caps pageSize at 50. */
export function discountCodesPath(query: AdminDiscountCodeQuery): string {
  return withQuery('/admin/discount-codes', {
    page: query.page,
    pageSize: Math.min(query.pageSize, 50),
    q: query.q,
    status: query.status,
    linked: query.linked ? '1' : undefined,
  });
}

export function adminDiscountCodes(
  get: ApiGet,
): Pick<DataSource['admin'], 'listDiscountCodes' | 'getDiscountCode' | 'listDiscountCodeUses'> {
  return {
    async listDiscountCodes(query) {
      const page = await getJson(get, discountCodesPath(query), isCodePage);
      return {
        items: page.items.map(pickCode),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
      };
    },
    async getDiscountCode(id) {
      if (!UUID.test(id)) return null; // the API would answer 400; for the page it is simply not found
      const raw = await getJsonOrNull(
        get,
        `/admin/discount-codes/${encodeURIComponent(id)}`,
        isCodeRow,
      );
      return raw ? pickCode(raw) : null;
    },
    async listDiscountCodeUses(id, query): Promise<AdminDiscountCodeUses | null> {
      if (!UUID.test(id)) return null;
      const raw = await getJsonOrNull(
        get,
        withQuery(`/admin/discount-codes/${encodeURIComponent(id)}/uses`, {
          page: query.page,
          pageSize: Math.min(query.pageSize, 50),
        }),
        isUses,
      );
      if (!raw) return null;
      const totals = raw.totals as Raw;
      return {
        items: (raw.items as unknown[]).map(pickUse),
        page: raw.page as number,
        pageSize: raw.pageSize as number,
        total: raw.total as number,
        totals: {
          uses: totals.uses as number,
          discountMinor: totals.discountMinor as number,
          collectedMinor: totals.collectedMinor as number,
        },
      };
    },
  };
}
