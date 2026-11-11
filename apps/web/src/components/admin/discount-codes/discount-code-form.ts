import type { AdminDiscountCode, DiscountKind } from '@sirat/shared';

/*
 * The discount-code form's values and their conversion to the API body (payments D2). Pure, for node --test: the
 * page shows taka and local times; the API takes paisa and ISO instants.
 */

export interface DiscountCodeValues {
  code: string;
  kind: DiscountKind;
  /** Taka for an amount, 1-99 for a percent, as typed. */
  value: string;
  maxUses: string;
  /** datetime-local values ("2026-11-20T10:00"), local time; '' = none. */
  startsAt: string;
  endsAt: string;
  active: boolean;
  ambassadorCode: string;
  note: string;
}

export const EMPTY_CODE: DiscountCodeValues = {
  code: '',
  kind: 'amount',
  value: '',
  maxUses: '',
  startsAt: '',
  endsAt: '',
  active: true,
  ambassadorCode: '',
  note: '',
};

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** "Generate": DC- + 8 Crockford characters from the browser's strong random source (the server checks it again). */
export function generatedCode(random: (n: number) => Uint8Array): string {
  return `DC-${Array.from(random(8), (b) => CROCKFORD[b % 32]).join('')}`;
}

/** An ISO instant as a datetime-local value in the browser's zone ('' for none). */
export function toLocalInput(iso: string | null, offsetMinutes: number): string {
  if (!iso) return '';
  return new Date(Date.parse(iso) - offsetMinutes * 60_000).toISOString().slice(0, 16);
}

/** A datetime-local value as an ISO instant (null for none or an unreadable value). */
export function fromLocalInput(value: string, offsetMinutes: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00.000Z`);
  return Number.isNaN(ms) ? null : new Date(ms + offsetMinutes * 60_000).toISOString();
}

export function valuesOf(c: AdminDiscountCode, offsetMinutes: number): DiscountCodeValues {
  return {
    code: c.code,
    kind: c.kind,
    value: c.kind === 'amount' ? String(c.value / 100) : String(c.value),
    maxUses: c.maxUses === null ? '' : String(c.maxUses),
    startsAt: toLocalInput(c.startsAt, offsetMinutes),
    endsAt: toLocalInput(c.endsAt, offsetMinutes),
    active: c.active,
    ambassadorCode: c.ambassador?.promoCode ?? '',
    note: c.note ?? '',
  };
}

/** The field the form refuses before sending, or null. Whole numbers only; the server checks every rule again. */
export function invalidField(v: DiscountCodeValues): 'value' | 'maxUses' | null {
  const n = Number(v.value);
  const okValue =
    /^\d+$/.test(v.value.trim()) && (v.kind === 'percent' ? n >= 1 && n <= 99 : n >= 1);
  if (!okValue) return 'value';
  if (v.maxUses.trim() && !(/^\d+$/.test(v.maxUses.trim()) && Number(v.maxUses) >= 1))
    return 'maxUses';
  return null;
}

/** The API body (create and edit), the ambassador already resolved to a user id (or null for none). */
export function toBody(
  v: DiscountCodeValues,
  ambassadorUserId: string | null,
  offsetMinutes: number,
  mode: 'create' | 'edit',
): Record<string, unknown> {
  const value = Number(v.value.trim());
  const note = v.note.trim();
  return {
    ...(mode === 'create' && v.code.trim() ? { code: v.code.trim().toUpperCase() } : {}),
    kind: v.kind,
    value: v.kind === 'amount' ? value * 100 : value,
    maxUses: v.maxUses.trim() ? Number(v.maxUses.trim()) : null,
    startsAt: fromLocalInput(v.startsAt, offsetMinutes),
    endsAt: fromLocalInput(v.endsAt, offsetMinutes),
    active: v.active,
    ambassadorUserId,
    note: note ? note : null,
  };
}
