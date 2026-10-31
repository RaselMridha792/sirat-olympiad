import { useSyncExternalStore } from 'react';
import { readLinkToken } from '@/lib/auth/auth-errors';

/**
 * The token of an emailed link (`/reset-password#token=...`, `/verify-email#token=...`). The fragment never
 * reaches a server or a Referer. It is read when the page loads, and again when a new link is opened in the same
 * tab (only the fragment changes, so the page does not reload), then removed from the address bar (history,
 * screenshots, shoulder surfing) and kept in memory only.
 *   undefined  not read yet (server render, before hydration)
 *   null       missing or not the token's shape: the bad-link state, without a request
 */
let captured: string | null | undefined;

function read(): string | null {
  const { token, strip } = readLinkToken(captured, window.location.hash);
  captured = token;
  if (strip) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return token;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useLinkToken(): string | null | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}
