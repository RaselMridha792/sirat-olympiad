import type { CsvValue } from '../../common/csv';
import { csvRow, dhakaDateTime } from '../../common/csv';

/*
 * The audit-log export (06-API "Audit log"; lead 2026-11-01): the list's columns plus the meta, never the IP or an
 * email. Meta is written by many modules and may one day carry free text, so before it reaches the file every email,
 * Bangladeshi mobile number and IP address in it is replaced; a test feeds it each form.
 */

const EMAIL = /[^\s"'@,;:<>()[\]\\]+@[^\s"'@,;:<>()[\]\\]+\.[A-Za-z]{2,}/g;
/** 01XXXXXXXXX, with or without 88 / +88 in front (the forms the registration form accepts). */
const PHONE = /(?:\+?88)?01[3-9]\d{8}/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
/** Four or more groups, or a `::` form: an `hh:mm:ss` time has two colons and is left alone. */
const IPV6 =
  /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b|(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?/gi;

/** The meta as one JSON text with every email, phone number and IP address replaced. */
export function redactedMeta(meta: unknown): string {
  if (meta === null || meta === undefined) return '';
  return JSON.stringify(meta)
    .replace(EMAIL, '[email]')
    .replace(IPV6, (m) => (m.includes(':') && /[0-9a-f]/i.test(m) ? '[ip]' : m))
    .replace(IPV4, '[ip]')
    .replace(PHONE, '[phone]');
}

export const AUDIT_EXPORT_COLUMNS = [
  'time_dhaka',
  'action',
  'actor_name',
  'actor_role',
  'system',
  'entity_type',
  'entity_id',
  'meta',
] as const;

export interface AuditExportRow {
  createdAt: Date;
  action: string;
  actorName: string | null;
  actorRole: string | null;
  system: boolean;
  entityType: string | null;
  entityId: string | null;
  meta: unknown;
}

export function auditCsvRow(r: AuditExportRow): string {
  const cells: CsvValue[] = [
    dhakaDateTime(r.createdAt),
    r.action,
    r.actorName,
    r.actorRole,
    r.system ? 'yes' : 'no',
    r.entityType,
    r.entityId,
    redactedMeta(r.meta),
  ];
  return csvRow(cells);
}
