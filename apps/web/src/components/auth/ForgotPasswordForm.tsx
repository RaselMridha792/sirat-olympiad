'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Mail } from 'lucide-react';
import { Button, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { authMessages, type AuthMessages } from '@/i18n/messages/auth';
import { api, ApiRequestError } from '@/lib/api';
import { timeoutSignal } from '@/lib/auth/timeout';
import { useHydrated } from './useHydrated';

const REQUEST_TIMEOUT_MS = 15_000;

/** The error for a failed request: only a 204 counts as sent, never "sent" on a failure. */
function failureText(m: AuthMessages, error: unknown): string {
  const status = error instanceof ApiRequestError ? error.status : 0;
  if (status === 400) return m.forgot.invalidEmail;
  if (status === 429 || status >= 500) return m.busy;
  return m.network;
}

/**
 * An email form shared by forgot-password and the verify page's "send a new link". The API answers 204 at once
 * whatever the address (no account enumeration), so the confirmation is the same neutral text for everyone.
 */
export function EmailLinkRequest({
  locale,
  endpoint,
  submitLabel,
  sentText,
}: {
  locale: Locale;
  endpoint: '/auth/forgot-password' | '/auth/resend-verification';
  submitLabel: string;
  sentText: string;
}) {
  const m = pick(authMessages, locale);
  const hydrated = useHydrated();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError('');
    try {
      await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ email }),
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      setSent(true);
    } catch (err) {
      setError(failureText(m, err));
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <p role="status" className="text-center text-sm text-ink">
        {sentText}
      </p>
    );
  }
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5">
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
      {error ? (
        <p role="alert" className="text-center text-sm font-medium text-danger-strong">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" loading={sending} disabled={!hydrated} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}

export function ForgotPasswordForm({ locale }: { locale: Locale }) {
  const m = pick(authMessages, locale);
  return (
    <div className="space-y-5">
      <h2 className="text-center text-3xl font-bold">{m.forgot.title}</h2>
      <p className="text-center text-sm text-ink-muted">{m.forgot.subtitle}</p>
      <EmailLinkRequest
        locale={locale}
        endpoint="/auth/forgot-password"
        submitLabel={m.forgot.submit}
        sentText={m.forgot.sent}
      />
      <Link
        href="/login"
        className="block text-center text-sm font-semibold text-secondary hover:underline"
      >
        {m.backToLogin}
      </Link>
    </div>
  );
}
