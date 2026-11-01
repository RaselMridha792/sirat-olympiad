import type { Role } from '@sirat/shared';

/**
 * Who may open which dashboard page: one table for the page guards (lib/session.ts), the sidebars and the page
 * checks (scripts/check-pages.mjs). Pure (no Next imports) so node --test and the scripts can load it. It only
 * shapes the web: every API endpoint has its own guard (RULEBOOK §18).
 */
export type Area = 'student' | 'admin';

export const AREAS: Readonly<Record<Area, { prefix: string; roles: readonly Role[] }>> = {
  student: { prefix: '/dashboard', roles: ['student', 'ambassador'] },
  admin: { prefix: '/admin', roles: ['admin', 'manager', 'jury'] },
};

/** Pages (and everything below them) that only some roles of their area may open; the rest is open to the area. */
export const PAGE_ROLES: ReadonlyArray<{ path: string; roles: readonly Role[] }> = [
  { path: '/dashboard/ambassador', roles: ['ambassador'] },
  { path: '/admin/users', roles: ['admin'] },
  { path: '/admin/exams', roles: ['admin'] },
  { path: '/admin/ambassadors', roles: ['admin'] },
  { path: '/admin/announcements', roles: ['admin'] },
  { path: '/admin/payments', roles: ['admin'] },
  { path: '/admin/settings', roles: ['admin'] },
  { path: '/admin/book', roles: ['admin'] },
  { path: '/admin/book-orders', roles: ['admin'] },
  { path: '/admin/audit', roles: ['admin'] },
  { path: '/admin/tasks', roles: ['admin'] },
  { path: '/admin/teams', roles: ['admin'] },
  { path: '/admin/leaderboard', roles: ['admin', 'manager'] },
];

const within = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function areaOf(path: string): Area | null {
  if (within(path, AREAS.student.prefix)) return 'student';
  if (within(path, AREAS.admin.prefix)) return 'admin';
  return null;
}

export function areaFor(role: Role): Area {
  return AREAS.student.roles.includes(role) ? 'student' : 'admin';
}

/** Where a role lands after login, and where it is sent from the other area. */
export function homeFor(role: Role): string {
  return AREAS[areaFor(role)].prefix;
}

export type AccessDecision =
  { kind: 'ok' } | { kind: 'redirect'; to: string } | { kind: 'not-found' };

/**
 * The page at `path` (no query) for a user with `role`. The other area: to the user's own home. A page of the
 * user's area that the role may not open: not found (its existence is not confirmed). Not a dashboard path: not
 * found.
 */
export function decideAccess(path: string, role: Role): AccessDecision {
  const area = areaOf(path);
  if (!area) return { kind: 'not-found' };
  if (!AREAS[area].roles.includes(role)) return { kind: 'redirect', to: homeFor(role) };
  const rule = PAGE_ROLES.find((r) => within(path, r.path));
  return rule && !rule.roles.includes(role) ? { kind: 'not-found' } : { kind: 'ok' };
}

export function canOpen(path: string, role: Role): boolean {
  return decideAccess(path, role).kind === 'ok';
}
