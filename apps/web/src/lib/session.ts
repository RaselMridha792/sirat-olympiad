import type { SessionUser } from '@sirat/shared';

/**
 * Server-side session lookup for layouts (Server Components).
 * SCAFFOLD: returns a mock user so the UI can be previewed. Claude Code must replace this with a
 * call to GET /api/auth/me forwarding the request cookies, and redirect('/login') when null.
 * Role checks here only shape the UI; the API guards are the real protection.
 */
export async function getSession(role: SessionUser['role'] = 'student'): Promise<SessionUser> {
  return { id: 'mock-user', name: 'Demo User', email: 'demo@example.com', role };
}
