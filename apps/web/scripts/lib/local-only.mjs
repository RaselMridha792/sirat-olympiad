// The e2e test changes a fixture student's password, so it must only ever talk to this machine. Like the API's
// fixtures guard, it refuses anything else before it sends a single request.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** True only for an http(s) URL whose parsed host is 127.0.0.1, localhost or ::1. */
export function isLoopbackUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
  );
}
