'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { authMessages } from '@/i18n/messages/auth';
import { api, ApiRequestError } from '@/lib/api';
import { linkProblem } from '@/lib/auth/auth-errors';
import { EmailLinkRequest } from './ForgotPasswordForm';
import { useHydrated } from './useHydrated';
import { useLinkToken } from './useLinkToken';

/**
 * POST /api/auth/verify-email with exactly { token }, on a button press only (a mail scanner opening the link
 * changes nothing). Never logs in. A bad link also offers a new one, and a way to sign in for someone who has
 * already verified (the API cannot tell, it has one answer for every bad link).
 */
export function VerifyEmailForm({ locale }: { locale: Locale }) {
  const m = pick(authMessages, locale);
  const token = useLinkToken();
  const hydrated = useHydrated();
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<'ready' | 'done' | 'badLink'>('ready');

  async function verify() {
    if (busy.current || state !== 'ready' || !token) return;
    busy.current = true;
    setSending(true);
    setError('');
    try {
      await api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
      setState('done');
    } catch (err) {
      const problem = linkProblem(err instanceof ApiRequestError ? err : null);
      if (problem.kind === 'badLink') setState('badLink');
      else if (problem.kind === 'tooMany') setError(m.verify.tooMany);
      else setError(problem.kind === 'busy' ? m.busy : m.network);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  const heading = <h2 className="text-center text-3xl font-bold">{m.verify.title}</h2>;
  if (token === undefined) return heading;
  if (state === 'done') {
    return (
      <div className="space-y-5 text-center">
        {heading}
        <p role="status" className="text-sm text-ink">
          {m.verify.done}
        </p>
        <Link href="/login" className="font-semibold text-secondary hover:underline">
          {m.login.submit}
        </Link>
      </div>
    );
  }
  if (token === null || state === 'badLink') {
    return (
      <div className="space-y-5">
        {heading}
        <p role="alert" className="text-center text-sm font-medium text-danger-strong">
          {m.verify.badLink}
        </p>
        <Link
          href="/login"
          className="block text-center text-sm font-semibold text-secondary hover:underline"
        >
          {m.verify.alreadyVerified}
        </Link>
        <h3 className="pt-2 text-center text-lg font-semibold">{m.verify.resendTitle}</h3>
        <EmailLinkRequest
          locale={locale}
          endpoint="/auth/resend-verification"
          submitLabel={m.verify.resendSubmit}
          sentText={m.verify.resendSent}
        />
      </div>
    );
  }
  return (
    <div className="space-y-5 text-center">
      {heading}
      <p className="text-sm text-ink-muted">{m.verify.subtitle}</p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger-strong">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        size="lg"
        loading={sending}
        disabled={!hydrated}
        onClick={verify}
        className="w-full"
      >
        {m.verify.submit}
      </Button>
    </div>
  );
}
