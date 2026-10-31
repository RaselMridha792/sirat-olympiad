'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { authMessages } from '@/i18n/messages/auth';
import { allowRefreshVisit } from '@/lib/auth/loop-guard';
import { loginUrl, safeNext } from '@/lib/auth/next-param';
import { retryDelayMs } from '@/lib/auth/refresh';
import { refreshSession } from '@/lib/auth/refresh-browser';

/** Counted once per page load (React's dev mode runs effects twice). */
let visitAllowed: boolean | null = null;
/** A renewal still unanswered after this is shown as slow; the request itself keeps going (refresh-browser.ts). */
const SLOW_AFTER_MS = 10_000;

/**
 * /refresh: renews the session in the browser and goes back to `next` (a dashboard page, checked by safeNext).
 * The server sends people here when the access cookie is missing or expired; it cannot renew the session itself
 * because the refresh cookie is only sent to /api/auth. Expired: /login. Slow: says so and keeps waiting for the
 * answer. Unavailable (network, rate limit, server): keeps trying (after Retry-After when the server sends one,
 * else with a growing pause), never to /login on its own.
 */
/** Where to go back to: `next` when it is a safe dashboard page, else the student home. */
function target(): string {
  const raw = new URLSearchParams(window.location.search).get('next');
  return safeNext(raw, window.location.origin) ?? '/dashboard';
}

export function RefreshScreen({ locale }: { locale: Locale }) {
  const m = pick(authMessages, locale);
  const [state, setState] = useState<'working' | 'slow' | 'unavailable'>('working');
  const wake = useRef<(() => void) | null>(null);

  useEffect(() => {
    const next = target();
    visitAllowed ??= allowRefreshVisit(window.sessionStorage, next, Date.now());
    if (!visitAllowed) {
      window.location.replace(loginUrl(next));
      return;
    }
    let stopped = false;
    let slow: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      for (let attempt = 0; !stopped; attempt += 1) {
        slow = setTimeout(
          () => setState((now) => (now === 'working' ? 'slow' : now)),
          SLOW_AFTER_MS,
        );
        const result = await refreshSession();
        clearTimeout(slow);
        if (stopped) return;
        if (result.outcome === 'ok') return window.location.replace(next);
        if (result.outcome === 'expired') return window.location.replace(loginUrl(next));
        setState('unavailable');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, retryDelayMs(attempt, result.retryAfterMs));
          wake.current = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(slow);
      wake.current?.();
    };
  }, []);

  const loginInstead = (
    <a
      href="/login"
      onClick={(event) => {
        event.preventDefault();
        window.location.assign(loginUrl(target()));
      }}
      className="block text-sm font-semibold text-secondary hover:underline"
    >
      {m.refresh.loginInstead}
    </a>
  );

  return (
    <div className="space-y-5 text-center">
      <h2 className="text-3xl font-bold">{m.refresh.title}</h2>
      <noscript>
        <a href="/login" className="font-semibold text-secondary hover:underline">
          {m.refresh.loginInstead}
        </a>
      </noscript>
      <div role="status" aria-live="polite" className="space-y-4">
        {state === 'unavailable' ? (
          <>
            <p className="text-sm text-ink-muted">{m.refresh.unavailable}</p>
            <Button type="button" onClick={() => wake.current?.()}>
              {m.refresh.retry}
            </Button>
            {loginInstead}
          </>
        ) : state === 'slow' ? (
          <>
            <p className="text-sm text-ink-muted">{m.refresh.slow}</p>
            {loginInstead}
          </>
        ) : null}
      </div>
    </div>
  );
}
