'use client';
import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { authMessages } from '@/i18n/messages/auth';
import { api, SessionExpiredError } from '@/lib/api';

/** Tabs of this browser tell each other about a logout (shared school computers). */
const CHANNEL = 'sirat-auth';
const LOGGED_OUT = 'logged-out';

function announceLogout(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(LOGGED_OUT);
  channel.close();
}

/** Leaves the dashboard when another tab logs out, and never shows a page restored from the back-forward cache. */
function useSessionWatch(): void {
  useEffect(() => {
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        if (event.data === LOGGED_OUT) window.location.replace('/login');
      };
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload(); // the server decides again (proxy, session)
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      channel?.close();
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
}

const TONES = {
  shell: 'text-white hover:bg-white/10 focus-visible:outline-white',
  surface: 'text-ink hover:bg-page focus-visible:outline-primary',
} as const;

/**
 * POST /api/auth/logout through api(): an expired access token is renewed first and the logout repeated. Goes to
 * /login only when this device is really logged out: a 204, or a refresh that said 401 (the API then cleared both
 * cookies). Anything else leaves the user here with "not logged out yet", never a false sense of being out.
 */
export function LogoutButton({ locale, tone }: { locale: Locale; tone: keyof typeof TONES }) {
  const m = pick(authMessages, locale);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useSessionWatch();

  async function logout() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      await api('/auth/logout', { method: 'POST', onExpired: 'throw' });
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        setFailed(true);
        setPending(false);
        return;
      }
    }
    announceLogout();
    window.location.replace('/login');
  }

  return (
    <div className="flex items-center gap-2">
      {failed ? (
        <p
          role="alert"
          className={`max-w-48 text-xs font-medium ${tone === 'shell' ? 'text-white' : 'text-danger-strong'}`}
        >
          {m.logout.failed}
        </p>
      ) : null}
      <button
        type="button"
        onClick={logout}
        disabled={pending}
        aria-busy={pending || undefined}
        className={`flex items-center gap-2 rounded-control p-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${TONES[tone]}`}
      >
        <LogOut size={18} aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">
          {pending ? m.logout.submitting : m.logout.submit}
        </span>
      </button>
    </div>
  );
}
