'use client';
import { useEffect, useState } from 'react';
import { BadgeCheck, CircleX, TriangleAlert } from 'lucide-react';
import { CERTIFICATE_CODE_PATTERN, type CertificateCheck as Check } from '@sirat/shared';
import { api, ApiRequestError } from '@/lib/api';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { certificatesMessages } from '@/i18n/messages/certificates';

type State =
  { kind: 'checking' } | { kind: 'valid'; check: Check } | { kind: 'notValid' | 'busy' | 'failed' };

/**
 * The public check (core C6c-1). The browser calls GET /api/certificates/verify/:code itself, through nginx, so the
 * per-IP limit counts the visitor, not the web server. Only the name and the award ever come back. A demo certificate
 * (demo data) says plainly that it is not a real award (lead, 2026-11-09).
 */
export function CertificateCheck({ locale, code }: { locale: Locale; code: string }) {
  const m = pick(certificatesMessages, locale);
  const [state, setState] = useState<State>(
    CERTIFICATE_CODE_PATTERN.test(code) ? { kind: 'checking' } : { kind: 'notValid' },
  );

  useEffect(() => {
    if (!CERTIFICATE_CODE_PATTERN.test(code)) return;
    let live = true;
    api<Check>(`/certificates/verify/${encodeURIComponent(code)}`)
      .then((check) => live && setState({ kind: 'valid', check }))
      .catch((error: unknown) => {
        if (!live) return;
        const status = error instanceof ApiRequestError ? error.status : 0;
        setState({ kind: status === 404 ? 'notValid' : status === 429 ? 'busy' : 'failed' });
      });
    return () => {
      live = false;
    };
  }, [code]);

  if (state.kind === 'checking')
    return (
      <p className="text-sm text-ink-muted" aria-live="polite">
        {m.check.checking}
      </p>
    );
  if (state.kind === 'valid')
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        {state.check.demo === false ? (
          <p className="flex items-center gap-2 text-lg font-bold text-success-strong">
            <BadgeCheck aria-hidden="true" size={22} />
            {m.check.valid}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2 text-lg font-bold text-warning-strong">
              <TriangleAlert aria-hidden="true" size={22} />
              {m.check.demo}
            </p>
            <p className="text-sm text-ink-muted">{m.check.demoHint}</p>
          </div>
        )}
        <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-ink-muted">{m.check.name}</dt>
          <dd className="font-semibold text-ink">{state.check.name}</dd>
          <dt className="text-ink-muted">{m.check.award}</dt>
          <dd className="font-semibold text-ink">
            {m.award(m.types[state.check.award.type], state.check.award.roundName)}
          </dd>
        </dl>
      </div>
    );
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className="flex items-center gap-2 text-lg font-bold text-danger-strong">
        <CircleX aria-hidden="true" size={22} />
        {state.kind === 'notValid'
          ? m.check.notValid
          : state.kind === 'busy'
            ? m.check.busy
            : m.check.failed}
      </p>
      {state.kind === 'notValid' ? (
        <p className="text-sm text-ink-muted">{m.check.notValidHint}</p>
      ) : null}
    </div>
  );
}
