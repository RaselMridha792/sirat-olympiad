'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Lock, Mail } from 'lucide-react';
import { Button, Field } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { authMessages, type AuthMessages } from '@/i18n/messages/auth';
import { api, ApiRequestError } from '@/lib/api';
import { loginProblem, type LoginProblem } from '@/lib/auth/auth-errors';
import { safeNext } from '@/lib/auth/next-param';
import { timeoutSignal } from '@/lib/auth/timeout';

/** The old login gave up after 15 s on slow networks and offered "try again". */
const LOGIN_TIMEOUT_MS = 15_000;

function problemText(m: AuthMessages, problem: LoginProblem): string {
  switch (problem.kind) {
    case 'wrong':
      return m.login.wrong;
    case 'locked':
      return m.login.locked(problem.minutes);
    case 'blocked':
      return m.login.blocked;
    case 'invalidEmail':
      return m.login.invalidEmail;
    case 'busy':
      return m.busy;
    case 'network':
      return m.network;
  }
}

/**
 * POST /api/auth/login; the server sets the httpOnly cookies, nothing is stored here. Then a full page load of
 * `next` (a safe dashboard page) or /dashboard: no /me call, the dashboard layouts send staff on to /admin.
 */
export function LoginForm({ locale }: { locale: Locale }) {
  const m = pick(authMessages, locale);
  const hydrated = useHydrated();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
        signal: timeoutSignal(LOGIN_TIMEOUT_MS),
      });
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.replace(safeNext(next, window.location.origin) ?? '/dashboard');
      return; // keep the button busy while the next page loads
    } catch (err) {
      setError(problemText(m, loginProblem(err instanceof ApiRequestError ? err : null)));
    }
    setLoading(false);
  }

  return (
    // method="post": even a submit that slipped past the disabled button never puts credentials in a URL.
    <form method="post" onSubmit={onSubmit} className="space-y-5">
      <h2 className="text-center text-3xl font-bold">{m.login.title}</h2>
      <p className="text-center text-sm text-ink-muted">{m.login.subtitle}</p>
      <Field
        label={m.email}
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        icon={<Mail size={18} />}
      />
      <Field
        label={m.password}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={256}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        icon={<Lock size={18} />}
      />
      <Link
        href="/forgot-password"
        className="block text-sm font-semibold text-secondary hover:underline"
      >
        {m.login.forgot}
      </Link>
      {error ? (
        <p role="alert" className="text-center text-sm font-medium text-danger-strong">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        loading={loading}
        loadingLabel={m.login.submitting}
        disabled={!hydrated}
        className="w-full"
      >
        {m.login.submit}
      </Button>
      <p className="text-center text-sm text-ink-muted">
        {m.login.noAccount}{' '}
        <Link href="/register" className="font-bold text-secondary hover:underline">
          {m.login.register}
        </Link>
      </p>
    </form>
  );
}
