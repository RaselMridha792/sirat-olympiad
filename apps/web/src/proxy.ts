import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runs before the dashboard pages only (matcher below): never on /refresh, the login and email-link pages, /api,
 * /_next or the public site, so it cannot loop and costs the public pages nothing.
 * - A page load or navigation (GET/HEAD) without the access cookie goes straight to /refresh: the access cookie
 *   expires with its 15-minute token, so this is the usual way back after a break.
 * - Everything else passes, Server Actions (POST) included: they check the session themselves (requireAccess).
 * - The page's path travels in x-sirat-path (always overwritten here), so lib/session.ts can send the user back.
 */
const ACCESS_COOKIE = 'sirat_access';

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const here = pathname + search;
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  if (isRead && !request.cookies.get(ACCESS_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = '/refresh';
    url.search = '';
    url.searchParams.set('next', here);
    return NextResponse.redirect(url, 307);
  }
  const forwarded = new Headers(request.headers);
  forwarded.set('x-sirat-path', here);
  return NextResponse.next({ request: { headers: forwarded } });
}

export const config = { matcher: ['/dashboard/:path*', '/admin/:path*'] };
