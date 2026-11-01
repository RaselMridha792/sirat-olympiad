import type { AdminAuditDetail, AdminAuditQuery, AdminAuditRow } from '@sirat/shared';
import type { MockUser } from './fixtures.ts';

/*
 * Demo audit rows for the dev-only mock (the audit-log viewer, core). Deterministic: the same world gives the same
 * rows. Each row carries its detail (IP, email, meta) separately, so the list can drop it the way the API does.
 */

export type MockAuditRow = AdminAuditRow & {
  detail: Pick<AdminAuditDetail, 'ip' | 'actorEmail' | 'meta'>;
};

const ACTIONS = [
  'auth.login_failed',
  'users.exported',
  'ambassador.approved',
  'announcement.created',
  'payments.recheck_requested',
  'settings.changed',
  'auth.password_changed',
  'registration.completed',
] as const;

const BASE = Date.parse('2026-11-01T06:00:00.000Z');

export function mockAudit(users: readonly MockUser[]): MockAuditRow[] {
  const staff = users.filter((u) => u.role === 'admin');
  const rows: MockAuditRow[] = [];
  for (let i = 0; i < 60; i += 1) {
    const action = ACTIONS[i % ACTIONS.length]!;
    const system = action === 'registration.completed' || i % 11 === 0;
    const actor = system
      ? null
      : action.startsWith('auth.')
        ? users[i % users.length]
        : (staff[i % Math.max(staff.length, 1)] ?? users[0]);
    rows.push({
      id: `0190a000-0000-7000-8000-${String(i).padStart(12, '0')}`,
      createdAt: new Date(BASE - i * 47 * 60_000).toISOString(),
      action,
      system,
      actor: actor ? { name: actor.name, role: actor.role } : null,
      entityType: action.startsWith('auth.') ? 'user' : action.split('.')[0]!,
      entityId: actor ? actor.id : null,
      detail: {
        ip: system ? null : `203.0.113.${(i % 200) + 1}`,
        actorEmail: actor ? actor.email : null,
        meta:
          action === 'users.exported' ? { rowCount: 120 + i, reason: 'Weekly check' } : { n: i },
      },
    });
  }
  return rows;
}

const DHAKA_OFFSET_MS = 6 * 3_600_000;
const dhakaDay = (iso: string) =>
  new Date(Date.parse(iso) + DHAKA_OFFSET_MS).toISOString().slice(0, 10);

/** The API's filters, applied to the demo rows (an action or a family, the actor, Dhaka days). */
export function auditMatches(row: MockAuditRow, q: AdminAuditQuery): boolean {
  if (q.action) {
    const ok = q.action.endsWith('.*')
      ? row.action.startsWith(q.action.slice(0, -1))
      : row.action === q.action;
    if (!ok) return false;
  }
  if (q.actor === 'system' && !row.system) return false;
  if (
    q.actor &&
    q.actor !== 'system' &&
    row.detail.actorEmail?.toLowerCase() !== q.actor.toLowerCase()
  )
    return false;
  const day = dhakaDay(row.createdAt);
  if (q.from && day < q.from) return false;
  if (q.to && day > q.to) return false;
  return true;
}
