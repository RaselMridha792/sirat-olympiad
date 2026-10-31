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
