import { BOOK_COVER_LIMITS, type ApiError, type BookOrderStatus } from '@sirat/shared';
import type { AdminBookMessages } from '../../../i18n/messages/admin-book.ts';

/*
 * The admin book pages' rules (06-API "Free book"): how a refusal is read, a quick check of a chosen file before it
 * is sent (the API checks the bytes again), and the export's path. Pure, for node --test.
 */

export type AdminBookProblem = keyof AdminBookMessages['errors'];

const CODES = new Set<string>([
  'SETTING_CHANGED',
  'COVER_MISSING',
  'COVER_UNSUPPORTED_TYPE',
  'COVER_UNREADABLE',
  'COVER_BAD_DIMENSIONS',
  'COVER_TOO_LARGE',
  'COVER_EMPTY',
]);

export function adminBookProblem(
  answer: { status: number; body: ApiError | null } | null,
): AdminBookProblem {
  if (!answer) return 'network';
  const code = answer.body?.code ?? '';
  if (CODES.has(code)) return code as AdminBookProblem;
  if (answer.status === 413) return 'COVER_TOO_LARGE'; // nginx or multer, before the API's own code
  if (answer.status === 400) return 'invalid';
  if (answer.status === 403) return 'denied';
  return 'busy';
}

/** Before sending: empty, too large, or a type the browser already knows is not an image we take. */
export function preCheckCover(file: { size: number; type: string }): AdminBookProblem | null {
  if (file.size === 0) return 'COVER_EMPTY';
  if (file.size > BOOK_COVER_LIMITS.maxBytes) return 'COVER_TOO_LARGE';
  // An empty type is left to the API (it decides by the bytes anyway).
  if (file.type && !(BOOK_COVER_LIMITS.types as readonly string[]).includes(file.type))
    return 'COVER_UNSUPPORTED_TYPE';
  return null;
}

export function exportPath(filters: { status?: BookOrderStatus; district?: string }): string {
  const q = new URLSearchParams();
  if (filters.status) q.set('status', filters.status);
  if (filters.district) q.set('district', filters.district);
  const s = q.toString();
  return `/admin/book-orders/export.csv${s ? `?${s}` : ''}`;
}
