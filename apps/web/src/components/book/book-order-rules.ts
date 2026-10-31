import {
  BD_DISTRICTS,
  BOOK_ORDER_LIMITS,
  normalizeBdMobile,
  type ApiError,
  type BookOrderInput,
  type MyBookOrderView,
} from '@sirat/shared';
import type { BookMessages } from '../../i18n/messages/book.ts';

/*
 * The book order form's rules, as the API's BookOrderDto checks them (06-API "Free book"), and how its refusals are
 * read. Pure, for node --test.
 */

export interface BookFormValues {
  recipientName: string;
  recipientPhone: string;
  district: string;
  upazila: string;
  addressLine: string;
  note: string;
}
export type BookField = keyof BookFormValues;
export type BookInvalidKey = keyof BookMessages['invalid'];

const squash = (s: string) => s.trim().replace(/\s+/g, ' ');
const L = BOOK_ORDER_LIMITS;

/** The form's starting values: the order when there is one, else the student's own name, phone and district. */
export function initialBookValues(
  order: MyBookOrderView | null,
  profile: { name: string; phone: string | null; district: string | null },
): BookFormValues {
  if (order)
    return {
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      district: order.district,
      upazila: order.upazila,
      addressLine: order.addressLine,
      note: order.note ?? '',
    };
  return {
    recipientName: profile.name,
    recipientPhone: profile.phone ?? '',
    district:
      profile.district && (BD_DISTRICTS as readonly string[]).includes(profile.district)
        ? profile.district
        : '',
    upazila: '',
    addressLine: '',
    note: '',
  };
}

export function validateBookForm(v: BookFormValues): Partial<Record<BookField, BookInvalidKey>> {
  const errors: Partial<Record<BookField, BookInvalidKey>> = {};
  const name = squash(v.recipientName);
  if (!name) errors.recipientName = 'required';
  else if (name.length > L.recipientNameMax) errors.recipientName = 'recipientName';
  if (!v.recipientPhone.trim()) errors.recipientPhone = 'required';
  else if (!normalizeBdMobile(v.recipientPhone)) errors.recipientPhone = 'recipientPhone';
  if (!(BD_DISTRICTS as readonly string[]).includes(v.district)) errors.district = 'choose';
  const upazila = squash(v.upazila);
  if (!upazila) errors.upazila = 'required';
  else if (upazila.length < L.upazilaMin || upazila.length > L.upazilaMax)
    errors.upazila = 'upazila';
  const address = squash(v.addressLine);
  if (!address) errors.addressLine = 'required';
  else if (address.length < L.addressLineMin || address.length > L.addressLineMax)
    errors.addressLine = 'addressLine';
  if (squash(v.note).length > L.noteMax) errors.note = 'note';
  return errors;
}

/**
 * The PUT body. `expectedVersion` is always sent once an order exists (lead, 2026-11-01): a save from an old tab is
 * then a 409, never a silent overwrite.
 */
export function toBookInput(v: BookFormValues, existing: MyBookOrderView | null): BookOrderInput {
  const note = squash(v.note);
  return {
    recipientName: squash(v.recipientName),
    recipientPhone: normalizeBdMobile(v.recipientPhone) ?? v.recipientPhone.trim(),
    district: v.district,
    upazila: squash(v.upazila),
    addressLine: squash(v.addressLine),
    ...(note ? { note } : {}),
    ...(existing ? { expectedVersion: existing.version } : {}),
  };
}

export type BookProblem = Exclude<keyof BookMessages['errors'], never>;

export function bookProblem(answer: { status: number; body: ApiError | null } | null): BookProblem {
  if (!answer) return 'network';
  const code = answer.body?.code;
  if (
    code === 'BOOK_NOT_ELIGIBLE' ||
    code === 'BOOK_ORDER_SHIPPED' ||
    code === 'BOOK_ORDER_CHANGED'
  )
    return code;
  if (answer.status === 400) return 'invalid';
  return 'busy';
}
