import { ApiRequestError } from '../../lib/api.ts';

export type AnnouncementProblem =
  'stale' | 'archived' | 'notArchived' | 'publishInPast' | 'nothingToUpdate' | 'invalid' | 'failed';

const BY_CODE: Record<string, AnnouncementProblem> = {
  stale: 'stale',
  archived: 'archived',
  not_archived: 'notArchived',
  publish_in_past: 'publishInPast',
  nothing_to_update: 'nothingToUpdate',
};

/** Which message a refused announcement write gets (06-API "Announcements"). Pure, for node --test. */
export function announcementProblem(error: unknown): AnnouncementProblem {
  if (!(error instanceof ApiRequestError)) return 'failed';
  const details = Array.isArray(error.body?.details) ? (error.body.details as unknown[]) : [];
  for (const code of details) {
    const problem = typeof code === 'string' ? BY_CODE[code] : undefined;
    if (problem) return problem;
  }
  return error.status === 400 ? 'invalid' : 'failed';
}

/** A datetime-local value ("2026-11-02T10:00", the admin's clock) as ISO, or undefined when empty. */
export function localToIso(value: string): string | undefined {
  if (!value) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** An ISO time as a datetime-local value in the admin's clock. */
export function isoToLocal(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
