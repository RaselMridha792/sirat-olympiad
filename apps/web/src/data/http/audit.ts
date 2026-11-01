import {
  ROLES,
  type AdminAuditDetail,
  type AdminAuditPage,
  type AdminAuditRow,
} from '@sirat/shared';
import type { DataSource } from '../source.ts';
import { getJson, getJsonOrNull, isRecord, withQuery, type ApiGet } from './request.ts';

/*
 * The audit-log viewer (core; 06-API "Audit log"). Reads only; the export is a browser write through lib/api.ts.
 * Rows are checked and picked by name: the list never carries an IP, an email or the meta, even if the API sent them.
 */

const text = (v: unknown): v is string => typeof v === 'string';
const textOrNull = (v: unknown) => v === null || typeof v === 'string';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRow = (v: unknown): v is AdminAuditRow =>
  isRecord(v) &&
  text(v.id) &&
  text(v.createdAt) &&
  text(v.action) &&
  typeof v.system === 'boolean' &&
  (v.actor === null ||
    (isRecord(v.actor) &&
      text(v.actor.name) &&
      (ROLES as readonly unknown[]).includes(v.actor.role))) &&
  textOrNull(v.entityType) &&
  textOrNull(v.entityId);

const isPage = (v: unknown): v is AdminAuditPage =>
  isRecord(v) && Array.isArray(v.items) && v.items.every(isRow) && textOrNull(v.next);

const isDetail = (v: unknown): v is AdminAuditDetail =>
  isRow(v) && isRecord(v) && textOrNull(v.ip) && textOrNull(v.actorEmail) && 'meta' in v;

export function pickAuditRow(r: AdminAuditRow): AdminAuditRow {
  return {
    id: r.id,
    createdAt: r.createdAt,
    action: r.action,
    system: r.system,
    actor: r.actor ? { name: r.actor.name, role: r.actor.role } : null,
    entityType: r.entityType,
    entityId: r.entityId,
  };
}

export function adminAudit(get: ApiGet): Pick<DataSource['admin'], 'listAudit' | 'getAuditEntry'> {
  return {
    /** GET /admin/audit: one keyset page, newest first. */
    async listAudit(query) {
      const page = await getJson(
        get,
        withQuery('/admin/audit', {
          action: query.action,
          actor: query.actor,
          from: query.from,
          to: query.to,
          before: query.before,
          limit: query.limit,
        }),
        isPage,
      );
      return { items: page.items.map(pickAuditRow), next: page.next };
    },
    /** GET /admin/audit/:id; an id that is not a UUID is simply not found (the API would refuse it with 400). */
    async getAuditEntry(id) {
      if (!UUID.test(id)) return null;
      const row = await getJsonOrNull(get, `/admin/audit/${id}`, isDetail);
      return (
        row && { ...pickAuditRow(row), ip: row.ip, actorEmail: row.actorEmail, meta: row.meta }
      );
    },
  };
}
