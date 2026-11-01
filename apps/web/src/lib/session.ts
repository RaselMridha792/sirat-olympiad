import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ROLES, type SessionUser } from '@sirat/shared';
import { areaFor, decideAccess, homeFor, type Area } from './access';
import { MeCache } from './auth/me-cache';
import { needsTwoFactor, TWO_FACTOR_PAGE } from './auth/two-factor';
import { ACCESS_COOKIE, serverGet, ServerApiError } from './server-api';

/**
 * The logged-in user for this request (Server Components and Server Actions), from GET /api/auth/me.
 * - No access cookie, or the API says 401: to /refresh, which renews the session in the browser (the refresh
 *   cookie is only sent to /api/auth) and comes back to this page.
 * - Anything else (API down, 429, timeout): thrown to the error boundary. Never to /login: a busy API must not
 *   log a whole exam hall out.
 * The web's checks only shape the pages; every API endpoint has its own guard (RULEBOOK §18).
 */
const meCache = new MeCache<SessionUser>(30_000, 5_000);

function isSessionUser(value: unknown): value is SessionUser {
  const v = value as Partial<SessionUser> | null;
  return (
    !!v &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.email === 'string' &&
    (ROLES as readonly string[]).includes(v.role ?? '')
  );
}

/**
 * /refresh, coming back to the page being rendered (src/proxy.ts puts its path in x-sirat-path). Also used by the
 * HTTP data source when a read gets 401 (data/http/server.ts).
 */
export async function refreshUrl(): Promise<string> {
  const path = (await headers()).get('x-sirat-path');
  const next = path && path.startsWith('/') && !path.startsWith('//') ? path : '/dashboard';
  return `/refresh?next=${encodeURIComponent(next)}`;
}

export const getSession = cache(async (): Promise<SessionUser> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect(await refreshUrl());
  const known = meCache.get(token);
  if (known) return known;
  const { status, body } = await serverGet('/auth/me', token);
  // Outside any try/catch: redirect() works by throwing.
  if (status === 401) redirect(await refreshUrl());
  if (status !== 200 || !isSessionUser(body))
    throw new ServerApiError('Session lookup failed', status);
  meCache.set(token, body);
  return body;
});

/** For a dashboard layout: the user, who must belong to this area (else to their own home). */
export async function requireArea(area: Area): Promise<SessionUser> {
  const user = await getSession();
  if (areaFor(user.role) !== area) redirect(homeFor(user.role));
  return user;
}

/**
 * For every dashboard page and Server Action, before any data call: `path` is the page's route (lib/access.ts).
 * Layouts do not re-render on client-side navigation, so each page checks for itself. An admin or manager whose
 * session has not proved the second factor goes to enrolment: the API refuses them every other admin page (403).
 */
export async function requireAccess(path: string): Promise<SessionUser> {
  const user = await getSession();
  const decision = decideAccess(path, user.role);
  if (decision.kind === 'redirect') redirect(decision.to);
  if (decision.kind === 'not-found') notFound();
  if (needsTwoFactor(user.twoFactor) && path !== TWO_FACTOR_PAGE) redirect(TWO_FACTOR_PAGE);
  return user;
}
