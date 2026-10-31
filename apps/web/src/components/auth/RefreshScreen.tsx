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

/**
 * /refresh: renews the session in the browser and goes back to `next` (a dashboard page, checked by safeNext).
 * The server sends people here when the access cookie is missing or expired; it cannot renew the session itself
 * because the refresh cookie is only sent to /api/auth. Expired: /login. Unavailable (network, rate limit,
 * server): keeps trying with a growing pause, never to /login on its own.
 */
/** Where to go back to: `next` when it is a safe dashboard page, else the student home. */
function target(): string {
  const raw = new URLSearchParams(window.location.search).get('next');
  return safeNext(raw, window.location.origin) ?? '/dashboard';
}

export function RefreshScreen({ locale }: { locale: Locale }) {
  const m = pick(authMessages, locale);
  const [unavailable, setUnavailable] = useState(false);
  const wake = useRef<(() => void) | null>(null);

  useEffect(() => {
    const next = target();
    visitAllowed ??= allowRefreshVisit(window.sessionStorage, next, Date.now());
    if (!visitAllowed) {
      window.location.replace(loginUrl(next));
      return;
    }
    let stopped = false;
    void (async () => {
      for (let attempt = 0; !stopped; attempt += 1) {
        const result = await refreshSession();
        if (stopped) return;
        if (result.outcome === 'ok') return window.location.replace(next);
        if (result.outcome === 'expired') return window.location.replace(loginUrl(next));
        setUnavailable(true);
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
      wake.current?.();
    };
  }, []);

  return (
    <div className="space-y-5 text-center">
      <h2 className="text-3xl font-bold">{m.refresh.title}</h2>
      <noscript>
        <a href="/login" className="font-semibold text-secondary hover:underline">
          {m.refresh.loginInstead}
        </a>
      </noscript>
      <div role="status" aria-live="polite" className="space-y-4">
        {unavailable ? (
          <>
            <p className="text-sm text-ink-muted">{m.refresh.unavailable}</p>
            <Button type="button" onClick={() => wake.current?.()}>
              {m.refresh.retry}
            </Button>
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
          </>
        ) : null}
      </div>
    </div>
  );
}
