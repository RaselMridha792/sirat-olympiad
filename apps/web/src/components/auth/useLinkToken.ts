import { useSyncExternalStore } from 'react';
import { linkTokenFrom } from '@/lib/auth/auth-errors';

/**
 * The token of an emailed link (`/reset-password#token=...`, `/verify-email#token=...`). The fragment never
 * reaches a server or a Referer. It is read once per page load, then removed from the address bar (history,
 * screenshots, shoulder surfing) and kept in memory only.
 *   undefined  not read yet (server render, before hydration)
 *   null       missing or not the token's shape: the bad-link state, without a request
 */
let captured: string | null | undefined;

function readOnce(): string | null {
  if (captured === undefined) {
    captured = linkTokenFrom(window.location.hash);
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
  return captured;
}

const subscribe = () => () => {};

export function useLinkToken(): string | null | undefined {
  return useSyncExternalStore(subscribe, readOnce, () => undefined);
}
