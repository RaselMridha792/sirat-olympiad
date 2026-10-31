import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { refreshUrl } from '@/lib/session';
import { ACCESS_COOKIE, serverGet } from '@/lib/server-api';
import type { ApiGet } from './request';

/**
 * `ApiGet` for the current page request (Server Components only). It sends only the access cookie, the student's
 * IP and nginx's request id (lib/server-api.ts). No cookie or a 401 (the access token expired since the session
 * check, which is cached for up to 30 s) goes to /refresh, as the session lookup does; every other status is
 * left to the area file.
 */
export const pageApiGet: ApiGet = async (path) => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect(await refreshUrl());
  const result = await serverGet(path, token);
  // Outside any try/catch: redirect() works by throwing.
  if (result.status === 401) redirect(await refreshUrl());
  return result;
};
