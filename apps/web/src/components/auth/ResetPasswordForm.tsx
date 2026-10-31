'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { authMessages } from '@/i18n/messages/auth';
import { api, ApiRequestError } from '@/lib/api';
import { linkProblem } from '@/lib/auth/auth-errors';
import { useHydrated } from './useHydrated';
import { useLinkToken } from './useLinkToken';

const MIN = 8;
const MAX = 128;

/**
 * POST /api/auth/reset-password with exactly { token, password }, on a button press only (never on page load,
 * so a mail scanner opening the link changes nothing). One request at a time; nothing after success. The API
 * ends every session and never logs in, so the user signs in with the new password.
 */
export function ResetPasswordForm({ locale }: { locale: Locale }) {
  const m = pick(authMessages, locale);
  const token = useLinkToken();
  const hydrated = useHydrated();
  const busy = useRef(false);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<'form' | 'done' | 'badLink'>('form');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current || state !== 'form' || !token) return;
    setError('');
    if (password.length < MIN) return setFieldError(m.reset.tooShort);
    if (password.length > MAX) return setFieldError(m.reset.tooLong);
    if (password !== repeat) return setFieldError(m.reset.mismatch);
    setFieldError('');
    busy.current = true;
    setSending(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setState('done');
    } catch (err) {
      const problem = linkProblem(err instanceof ApiRequestError ? err : null);
      if (problem.kind === 'badLink') setState('badLink');
      else if (problem.kind === 'policy') setFieldError(m.reset[problem.rule]);
      else if (problem.kind === 'tooMany') setError(m.reset.tooMany);
      else setError(problem.kind === 'busy' ? m.busy : m.network);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  const heading = <h2 className="text-center text-3xl font-bold">{m.reset.title}</h2>;
  if (token === undefined) return heading;
  if (state === 'done') {
    return (
      <div className="space-y-5 text-center">
        {heading}
        <p role="status" className="text-sm text-ink">
          {m.reset.done}
        </p>
        <Link href="/login" className="font-semibold text-secondary hover:underline">
          {m.login.submit}
        </Link>
      </div>
    );
  }
  if (token === null || state === 'badLink') {
    return (
      <div className="space-y-5 text-center">
        {heading}
        <p role="alert" className="text-sm font-medium text-danger-strong">
          {m.reset.badLink}
        </p>
        <Link href="/forgot-password" className="font-semibold text-secondary hover:underline">
          {m.reset.requestNew}
        </Link>
      </div>
    );
  }
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5">
      {heading}
      <p className="text-center text-sm text-ink-muted">{m.reset.subtitle}</p>
      <Field
        label={m.reset.password}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN}
        maxLength={MAX}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldError || undefined}
        icon={<Lock size={18} />}
      />
      <Field
        label={m.reset.repeat}
        name="repeat"
        type="password"
        autoComplete="new-password"
        required
        maxLength={MAX}
        value={repeat}
        onChange={(e) => setRepeat(e.target.value)}
        icon={<Lock size={18} />}
      />
      {error ? (
        <p role="alert" className="text-center text-sm font-medium text-danger-strong">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" loading={sending} disabled={!hydrated} className="w-full">
        {m.reset.submit}
      </Button>
    </form>
  );
}
