import { isIP } from 'node:net';

/**
 * The client IP that server-side API calls send as X-Forwarded-For, so the API's limits count the student and not
 * the web container. Behind nginx, X-Real-IP is nginx's $remote_addr (nginx overwrites any client value). The
 * incoming X-Forwarded-For is never used: its first entries are whatever the client sent. Exactly one value goes
 * out, and the API (trust proxy 1) takes the last entry, so that is the address it sees. Without nginx (dev),
 * X-Real-IP is client input, so nothing is forwarded.
 */
export function forwardedFor(
  realIp: string | null | undefined,
  behindNginx: boolean,
): string | null {
  if (!behindNginx || !realIp) return null;
  const ip = realIp.trim();
  return isIP(ip) ? ip : null;
}

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Every header of a server-side API call, built from the page request: the access cookie (`cookie`, already
 * reduced to it), the client IP (above) and nginx's request id (nginx overwrites any client value), so the API's
 * log lines up with the page request. Nothing else from the browser goes along: no other cookie, no
 * authorization header, no client X-Forwarded-For.
 */
export function apiRequestHeaders(
  incoming: Pick<Headers, 'get'>,
  cookie: string,
  behindNginx: boolean,
): Record<string, string> {
  const out: Record<string, string> = { accept: 'application/json', cookie };
  const ip = forwardedFor(incoming.get('x-real-ip'), behindNginx);
  if (ip) out['x-forwarded-for'] = ip;
  const requestId = incoming.get('x-request-id');
  if (requestId && REQUEST_ID.test(requestId)) out['x-request-id'] = requestId;
  return out;
}
