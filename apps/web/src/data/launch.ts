import { parseMockState } from './mode.ts';
import type { DataSource } from './source.ts';

/**
 * Which dashboard pages have their data at launch (LAUNCH-PLAN §8, L1). A `soon` page shows "coming soon"
 * (components/ComingSoonPage) instead of calling its data. "Soon" comes only from this table, never from an API
 * answer: there is no try/catch around data calls, so a 404, 5xx or timeout still shows the error page, and a method
 * no area file implements still throws.
 *
 * Every /dashboard and /admin page has a row: launch.test.ts and scripts/check-pages.mjs fail otherwise. A new page
 * whose data is not ready adds `soon` here and calls `isLive()` after requireAccess() and before its first data call
 * (launch.test.ts checks the order); its owner flips the row to `live` when its area file lands.
 * Pure, for node --test and the scripts.
 */
export type LaunchState = 'live' | 'soon';
export type LaunchTable = Readonly<Record<string, LaunchState>>;

export const LAUNCH = {
  '/dashboard': 'live',
  '/dashboard/ambassador': 'live',
  '/dashboard/announcements': 'live',
  '/dashboard/book': 'live',
  '/dashboard/exam': 'live',
  '/dashboard/exam/[id]': 'live',
  '/dashboard/exam/[id]/review': 'live',
  '/dashboard/leaderboard': 'live',
  '/dashboard/profile': 'live',
  '/dashboard/profile/edit': 'live',
  '/dashboard/team': 'live',
  '/admin': 'live',
  '/admin/ambassadors': 'live',
  '/admin/announcements': 'live',
  '/admin/audit': 'live',
  '/admin/book': 'live',
  '/admin/book-orders': 'live',
  '/admin/exams': 'live',
  '/admin/exams/[id]': 'live',
  '/admin/exams/[id]/edit': 'live',
  '/admin/exams/new': 'live',
  '/admin/leaderboard': 'live',
  '/admin/payments': 'live',
  '/admin/settings': 'live',
  '/admin/tasks': 'live',
  '/admin/teams': 'live',
  '/admin/rounds': 'live',
  '/admin/jury': 'live',
  '/dashboard/round': 'live',
  '/admin/users': 'live',
} as const satisfies LaunchTable;

export type LaunchRoute = keyof typeof LAUNCH;

/**
 * True when the page at `route` may call its data, by `table`. Production (the HTTP source) follows the table;
 * development's mock has every method, so it is always live there unless `?mock=launch` previews the production
 * view. A route without a row is not live.
 */
export function liveIn(
  table: LaunchTable,
  route: string,
  source: Pick<DataSource, 'kind'>,
  mock?: string | string[],
): boolean {
  const preview = parseMockState(mock, process.env.NODE_ENV) === 'launch';
  if (source.kind === 'mock' && !preview) return true;
  return table[route] === 'live';
}

/** The page guard: `if (!isLive('/admin/x', data, params.mock)) return <ComingSoonPage … />`. */
export function isLive(
  route: LaunchRoute,
  source: Pick<DataSource, 'kind'>,
  mock?: string | string[],
): boolean {
  return liveIn(LAUNCH, route, source, mock);
}
