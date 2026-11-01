import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { Card } from '@sirat/ui';
import { TwoFactorSettings } from '@/components/admin/TwoFactorSettings';
import { adminSecurityMessages } from '@/i18n/messages/admin-security';
import { getMessages } from '@/i18n/server';
import { isTwoFactorStatus, needsTwoFactor, TWO_FACTOR_PAGE } from '@/lib/auth/two-factor';
import { ACCESS_COOKIE, serverGet, ServerApiError } from '@/lib/server-api';
import { refreshUrl, requireAccess } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminSecurityMessages);
  return { title: m.title };
}

/**
 * Two-factor login for admins and managers (06-API "Two-factor login"). The only admin page open before the code is
 * proved (lib/session.ts requireAccess). The status comes from GET /api/auth/2fa on the server; the changes are made
 * in the browser (TwoFactorSettings), which reloads once the API has set the new session.
 */
export default async function AdminSecurityPage() {
  const user = await requireAccess(TWO_FACTOR_PAGE);
  const [{ locale, m }, token] = await Promise.all([
    getMessages(adminSecurityMessages),
    cookies().then((c) => c.get(ACCESS_COOKIE)?.value),
  ]);
  if (!token) redirect(await refreshUrl());
  const { status, body } = await serverGet('/auth/2fa', token);
  // Outside any try/catch: redirect() works by throwing.
  if (status === 401) redirect(await refreshUrl());
  const unavailable =
    status === 503 && (body as { code?: unknown } | null)?.code === 'TWO_FACTOR_UNAVAILABLE';
  if (!unavailable && (status !== 200 || !isTwoFactorStatus(body)))
    throw new ServerApiError('Two-factor status failed', status);

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink md:text-2xl">
          <ShieldCheck aria-hidden="true" className="h-6 w-6 shrink-0 text-secondary" />
          {m.title}
        </h1>
        <p className="text-sm text-ink-muted">{m.intro}</p>
        {needsTwoFactor(user.twoFactor) ? (
          <p role="status" className="text-sm font-semibold text-warning-strong">
            {m.required}
          </p>
        ) : null}
      </Card>
      {unavailable || !isTwoFactorStatus(body) ? (
        <Card>
          <p className="text-sm text-ink-muted">{m.unavailable}</p>
        </Card>
      ) : (
        <TwoFactorSettings locale={locale} status={body} />
      )}
    </div>
  );
}
