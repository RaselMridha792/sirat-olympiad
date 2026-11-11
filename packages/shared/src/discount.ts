import type { PageQuery } from './dashboard';

/**
 * Discount codes (DECISIONS "Discount codes"; payments D1). The server alone prices a registration: these helpers are
 * the one price rule (the API's start, retry and quote) and the shapes the admin pages read. The amount to pay never
 * goes below MIN_PAYABLE_MINOR, so no code makes registration free.
 */

/** 10 BDT, in paisa: the least a discounted registration costs (the lead's default; no 100% codes). */
export const MIN_PAYABLE_MINOR = 1000;

export const DISCOUNT_KINDS = ['amount', 'percent'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** Canonical form: upper case, 4-20 of A-Z 0-9 and "-". */
export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9-]{4,20}$/;
/** Ambassador referral codes (SR-) and team join codes (TM-): a discount code never starts with these. */
export const RESERVED_CODE_PREFIXES = ['SR-', 'TM-'] as const;
/** What "Generate" makes: DC- + 8 Crockford characters (40 bits). */
export const GENERATED_DISCOUNT_CODE_PATTERN = /^DC-[0-9A-HJKMNP-TV-Z]{8}$/;

export function isDiscountCodeFormat(code: string): boolean {
  return (
    DISCOUNT_CODE_PATTERN.test(code) && !RESERVED_CODE_PREFIXES.some((p) => code.startsWith(p))
  );
}

/** True for an ambassador's referral code (the one promo field takes both kinds; the prefix tells them apart). */
export const isAmbassadorCode = (code: string): boolean => code.toUpperCase().startsWith('SR-');

export interface Price {
  /** The fee before any discount. */
  listAmountMinor: number;
  /** What the code took off, whole taka. */
  discountMinor: number;
  /** What PayStation charges: list - discount, never below MIN_PAYABLE_MINOR when a discount applies. */
  amountMinor: number;
}

/** The fee as it is, with no code. */
export const listPrice = (listMinor: number): Price => ({
  listAmountMinor: listMinor,
  discountMinor: 0,
  amountMinor: listMinor,
});

/**
 * The price with a code. A percentage is taken off and rounded DOWN to whole taka (the student pays at most
 * 99 paisa more than the exact percentage); either kind stops at MIN_PAYABLE_MINOR. Pure; whole-taka input only.
 */
export function priceWithDiscount(listMinor: number, kind: DiscountKind, value: number): Price {
  const raw = kind === 'amount' ? value : Math.floor((listMinor * value) / 100 / 100) * 100;
  const room = Math.max(0, listMinor - MIN_PAYABLE_MINOR);
  const discountMinor = Math.max(0, Math.min(raw, room));
  return { listAmountMinor: listMinor, discountMinor, amountMinor: listMinor - discountMinor };
}

/** 200 from POST /registrations/quote: the price the start would charge for this code now. */
export interface RegistrationQuote extends Price {
  currency: 'BDT';
  /** The code's kind, or null without a code or for an ambassador's code (a referral changes no price). */
  kind: DiscountKind | null;
}

/** One code in the admin list and detail (GET /admin/discount-codes, GET /admin/discount-codes/:id). */
export interface AdminDiscountCode {
  id: string;
  code: string;
  kind: DiscountKind;
  /** amount: paisa; percent: 1-99. */
  value: number;
  maxUses: number | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  note: string | null;
  ambassador: { userId: string; name: string; promoCode: string | null } | null;
  /** Paid uses, and checkouts in progress (a reserved use until the checkout expires). */
  uses: { paid: number; live: number };
  /** Kind, value and the ambassador lock after the first paid use; the rest stays editable. */
  locked: boolean;
  /** Where the code stands now, by the server's clock. */
  status: DiscountCodeStatus;
  /** Demo data: read only here, removed with the demo. */
  demo: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One paid use (GET /admin/discount-codes/:id/uses). */
export interface AdminDiscountCodeUse {
  paymentId: string;
  invoiceNumber: string;
  userId: string | null;
  name: string | null;
  /**
   * Masked by the server (maskParticipantId): with the email, the full ID is a login, so admin views never show it
   * (the lead, 11 Nov). The full ID appears only on the admit card page, the result page at issue and the email.
   */
  participantIdMasked: string | null;
  paidAt: string | null;
  listAmountMinor: number;
  discountMinor: number;
  amountMinor: number;
}

/** The uses page with its totals (all paid uses, not only this page). */
export interface AdminDiscountCodeUses {
  items: AdminDiscountCodeUse[];
  page: number;
  pageSize: number;
  total: number;
  totals: { uses: number; discountMinor: number; collectedMinor: number };
}

/** The admin list's status filter: active (usable now), inactive (switched off), expired, scheduled (not started). */
export const DISCOUNT_CODE_STATUSES = ['active', 'inactive', 'expired', 'scheduled'] as const;
export type DiscountCodeStatus = (typeof DISCOUNT_CODE_STATUSES)[number];

/** GET /admin/discount-codes filters (q: part of the code). */
export interface AdminDiscountCodeQuery extends PageQuery {
  status?: DiscountCodeStatus;
  linked?: boolean;
}

/** The status a code has at `now` (the admin list's filter uses the same rule in the database). */
export function discountCodeStatus(
  c: { active: boolean; startsAt: string | null; endsAt: string | null },
  now: number,
): DiscountCodeStatus {
  if (!c.active) return 'inactive';
  if (c.endsAt && Date.parse(c.endsAt) <= now) return 'expired';
  if (c.startsAt && Date.parse(c.startsAt) > now) return 'scheduled';
  return 'active';
}
