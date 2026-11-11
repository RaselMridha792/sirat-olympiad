'use client';
import { useState } from 'react';
import Link from 'next/link';
import { KeyRound, Lock, Mail } from 'lucide-react';
import { isParticipantId, normalizeParticipantId } from '@sirat/shared';
import { Button, Field } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { authMessages, type AuthMessages } from '@/i18n/messages/auth';
import { api, ApiRequestError } from '@/lib/api';
import { loginProblem, type LoginProblem } from '@/lib/auth/auth-errors';
import { safeNext } from '@/lib/auth/next-param';
import { timeoutSignal } from '@/lib/auth/timeout';
import {
  codeStepProblem,
  recoveryCodeFrom,
  totpFrom,
  type CodeStepProblem,
} from '@/lib/auth/two-factor';

/** The old login gave up after 15 s on slow networks and offered "try again". */
const LOGIN_TIMEOUT_MS = 15_000;

/** Students and ambassadors sign in with their participant ID; staff (admin, manager, jury) with a password. */
type LoginMode = 'participant' | 'staff';

function problemText(m: AuthMessages, problem: LoginProblem, mode: LoginMode): string {
  switch (problem.kind) {
    case 'wrong':
      return mode === 'participant' ? m.login.wrongId : m.login.wrong;
    case 'locked':
      // The participant ID has no password to reset: the lock just runs out.
      return mode === 'participant'
        ? m.login.lockedId(problem.minutes)
        : m.login.locked(problem.minutes);
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

function codeProblemText(m: AuthMessages, problem: CodeStepProblem): string {
  switch (problem.kind) {
    case 'wrongCode':
      return m.code.wrong;
    case 'expired':
      return m.code.expired;
    case 'locked':
      return m.code.locked(problem.minutes);
    case 'busy':
      return m.busy;
    case 'network':
      return m.network;
  }
}

/** A full page load of `next` (a safe dashboard page) or /dashboard: the dashboard layouts send staff on to /admin. */
function goNext(): void {
  const next = new URLSearchParams(window.location.search).get('next');
  window.location.replace(safeNext(next, window.location.origin) ?? '/dashboard');
}

/**
 * POST /api/auth/login; the server sets the httpOnly cookies, nothing is stored here. Students and ambassadors send
 * { email, participantId }, the ID on their admit card (owner, 2026-11-10); a typo (a wrong check digit) is caught
 * here before any request. Staff switch to { email, password }. An admin or manager with two-factor login gets 200
 * { twoFactorRequired } and an httpOnly challenge cookie instead of a session: the form then asks for the code
 * (POST /api/auth/2fa/verify), which starts the session. No /me call either way.
 */
export function LoginForm({ locale }: { locale: Locale }) {
  const m = pick(authMessages, locale);
  const hydrated = useHydrated();
  const [mode, setMode] = useState<LoginMode>('participant');
  const [email, setEmail] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeStep, setCodeStep] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const id = normalizeParticipantId(participantId);
    if (mode === 'participant' && !isParticipantId(id)) {
      setError(m.login.badId); // a typo: no request, and nothing counted against the account
      return;
    }
    setLoading(true);
    setError('');
    try {
      const credential = mode === 'participant' ? { participantId: id } : { password };
      const answer = await api<{ twoFactorRequired?: boolean } | undefined>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, ...credential }),
        signal: timeoutSignal(LOGIN_TIMEOUT_MS),
      });
      if (answer?.twoFactorRequired) {
        setPassword(''); // not kept in memory while the code is asked
        setCodeStep(true);
        setLoading(false);
        return;
      }
      goNext();
      return; // keep the button busy while the next page loads
    } catch (err) {
      setError(problemText(m, loginProblem(err instanceof ApiRequestError ? err : null), mode));
    }
    setLoading(false);
  }

  if (codeStep) {
    return (
      <CodeStep
        m={m}
        hydrated={hydrated}
        onBack={(message) => {
          setCodeStep(false);
          setError(message);
        }}
      />
    );
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
      {mode === 'participant' ? (
        <>
          <Field
            label={m.login.participantId}
            name="participantId"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={32}
            hint={m.login.participantIdHint}
            value={participantId}
            onChange={(e) => setParticipantId(e.target.value)}
            icon={<KeyRound size={18} />}
          />
          <Link
            href="/forgot-id"
            className="block text-sm font-semibold text-secondary hover:underline"
          >
            {m.login.forgotId}
          </Link>
        </>
      ) : (
        <>
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
        </>
      )}
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
      <button
        type="button"
        className="block w-full text-center text-sm font-semibold text-secondary hover:underline"
        onClick={() => {
          // The other credential is dropped, never sent along.
          setMode(mode === 'participant' ? 'staff' : 'participant');
          setParticipantId('');
          setPassword('');
          setError('');
        }}
      >
        {mode === 'participant' ? m.login.staffSwitch : m.login.participantSwitch}
      </button>
      <p className="text-center text-sm text-ink-muted">
        {m.login.noAccount}{' '}
        <Link href="/register" className="font-bold text-secondary hover:underline">
          {m.login.register}
        </Link>
      </p>
    </form>
  );
}

/**
 * The login's code step: a 6-digit authenticator code, or a recovery code. The challenge lives in the httpOnly
 * cookie the login set (5 minutes, 5 wrong codes); when it has ended, `onBack` returns to the password with a text.
 */
function CodeStep({
  m,
  hydrated,
  onBack,
}: {
  m: AuthMessages;
  hydrated: boolean;
  onBack: (message: string) => void;
}) {
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const code = recovery ? recoveryCodeFrom(value) : totpFrom(value);
    if (!code) {
      setError(recovery ? m.code.invalidRecovery : m.code.invalid);
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api('/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify(recovery ? { recoveryCode: code } : { code }),
        signal: timeoutSignal(LOGIN_TIMEOUT_MS),
      });
      goNext();
      return; // keep the button busy while the next page loads
    } catch (err) {
      const problem = codeStepProblem(err instanceof ApiRequestError ? err : null);
      if (problem.kind === 'expired') {
        onBack(m.code.expired);
        return;
      }
      if (problem.kind === 'wrongCode') setValue('');
      setError(codeProblemText(m, problem));
    }
    setLoading(false);
  }

  function switchMode() {
    setRecovery(!recovery);
    setValue('');
    setError('');
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5">
      <h2 className="text-center text-3xl font-bold">
        {recovery ? m.code.recoveryTitle : m.code.title}
      </h2>
      <p className="text-center text-sm text-ink-muted">
        {recovery ? m.code.recoverySubtitle : m.code.subtitle}
      </p>
      <Field
        key={recovery ? 'recovery' : 'app'}
        label={recovery ? m.code.recoveryLabel : m.code.label}
        name={recovery ? 'recoveryCode' : 'code'}
        type="text"
        inputMode={recovery ? 'text' : 'numeric'}
        autoComplete={recovery ? 'off' : 'one-time-code'}
        autoCapitalize={recovery ? 'characters' : 'off'}
        spellCheck={false}
        autoFocus
        required
        maxLength={recovery ? 20 : 9}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        icon={<KeyRound size={18} />}
      />
      <button
        type="button"
        onClick={switchMode}
        className="block text-sm font-semibold text-secondary hover:underline"
      >
        {recovery ? m.code.useApp : m.code.useRecovery}
      </button>
      {error ? (
        <p role="alert" className="text-center text-sm font-medium text-danger-strong">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        loading={loading}
        loadingLabel={m.code.submitting}
        disabled={!hydrated}
        className="w-full"
      >
        {m.code.submit}
      </Button>
      <button
        type="button"
        onClick={() => onBack('')}
        className="block w-full text-center text-sm font-semibold text-secondary hover:underline"
      >
        {m.backToLogin}
      </button>
    </form>
  );
}
