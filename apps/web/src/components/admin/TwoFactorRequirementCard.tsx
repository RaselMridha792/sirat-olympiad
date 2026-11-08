'use client';
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Badge, Button, Card, Field } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { formatDateTime } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { adminSecurityMessages, type AdminSecurityMessages } from '@/i18n/messages/admin-security';
import { api, ApiRequestError } from '@/lib/api';
import {
  requirementProblem,
  requirementReasonFrom,
  requirementRoles,
  totpFrom,
  type RequirableRole,
  type TwoFactorRequirement,
} from '@/lib/auth/two-factor';

const PATH = '/admin/security/two-factor-requirement';

function stateOf(m: AdminSecurityMessages['requirement'], roles: RequirableRole[]): string {
  if (roles.includes('admin') && roles.includes('manager')) return m.both;
  if (roles.includes('admin')) return m.admin;
  if (roles.includes('manager')) return m.manager;
  return m.none;
}

/**
 * /admin/security, for an admin whose session proved the code: who must sign in with two-factor login (DECISIONS "The
 * admin 2FA requirement is a setting"). The API decides everything: the change needs the admin's own current code,
 * and the set this page showed (`expected`), so an old page never overwrites someone else's change.
 */
export function TwoFactorRequirementCard({
  locale,
  requirement,
}: {
  locale: Locale;
  requirement: TwoFactorRequirement | null;
}) {
  const all = pick(adminSecurityMessages, locale);
  const m = all.requirement;
  const hydrated = useHydrated();
  const [current, setCurrent] = useState(requirement);
  const [ticked, setTicked] = useState({
    admin: requirement?.roles.includes('admin') ?? true,
    manager: requirement?.roles.includes('manager') ?? true,
  });
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  if (!current)
    return (
      <Card>
        <h2 className="text-lg font-bold text-ink">{m.title}</h2>
        <p className="mt-2 text-sm text-ink-muted">{m.loadFailed}</p>
      </Card>
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !current) return;
    const totp = totpFrom(code);
    if (!totp) {
      setError(all.invalidCode);
      return;
    }
    const why = requirementReasonFrom(reason);
    if (!why) {
      setError(m.reasonInvalid);
      return;
    }
    setBusy(true);
    setError('');
    setDone('');
    try {
      const out = await api<{ roles: RequirableRole[]; updatedAt: string }>(PATH, {
        method: 'PUT',
        body: JSON.stringify({
          roles: requirementRoles(ticked),
          expected: current.roles,
          reason: why,
          code: totp,
        }),
      });
      // The API answers 200 without writing anything when the set is already the current one.
      const changed = out.roles.join() !== current.roles.join();
      setCurrent({ ...current, roles: out.roles, updatedAt: out.updatedAt });
      setReason('');
      setCode('');
      setDone(changed ? m.saved : m.unchanged);
    } catch (err) {
      const problem = requirementProblem(err instanceof ApiRequestError ? err : null);
      if (problem === 'wrongCode') setCode('');
      setError(m.problems[problem]);
    }
    setBusy(false);
  }

  const off = current.roles.length < 2;
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-ink">{m.title}</h2>
      <p className="text-sm text-ink-muted">{m.text}</p>
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
        {m.current} <Badge tone={off ? 'warning' : 'success'}>{stateOf(m, current.roles)}</Badge>
      </p>
      {current.updatedAt ? (
        <p className="text-xs text-ink-faint">
          {m.updated(formatDateTime(locale, current.updatedAt))}
        </p>
      ) : null}
      {off ? (
        <p role="status" className="text-sm font-medium text-warning-strong">
          {m.offWarning}
        </p>
      ) : null}
      <form method="post" onSubmit={submit} className="flex max-w-md flex-col gap-4">
        {(['admin', 'manager'] as const).map((role) => (
          <label key={role} className="flex items-start gap-3 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              name={`require-${role}`}
              checked={ticked[role]}
              onChange={(e) => setTicked({ ...ticked, [role]: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            {role === 'admin' ? m.adminLabel : m.managerLabel}
          </label>
        ))}
        <Field
          id="requirement-reason"
          label={m.reason}
          name="reason"
          type="text"
          required
          minLength={3}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Field
          id="requirement-code"
          label={all.code}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          spellCheck={false}
          required
          maxLength={9}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          icon={<KeyRound size={18} />}
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-danger-strong">
            {error}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="text-sm font-medium text-success-strong">
            {done}
          </p>
        ) : null}
        <Button type="submit" loading={busy} loadingLabel={all.working} disabled={!hydrated}>
          {m.save}
        </Button>
      </form>
    </Card>
  );
}
