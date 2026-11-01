'use client';
import { useState } from 'react';
import { KeyRound, Lock } from 'lucide-react';
import { Badge, Button, Card, Field } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { adminSecurityMessages, type AdminSecurityMessages } from '@/i18n/messages/admin-security';
import { api, ApiRequestError } from '@/lib/api';
import {
  manualKeyFrom,
  recoveryCodeFrom,
  stepUpProblem,
  totpFrom,
  TWO_FACTOR_PAGE,
  type StepUpProblem,
  type TwoFactorStatus,
} from '@/lib/auth/two-factor';

/** Few enough recovery codes left to suggest new ones. */
const LOW_RECOVERY = 3;
/** The API's QR code: a PNG data URI (two-factor.service.ts). Anything else is not shown. */
const QR_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

function problemOf(err: unknown): StepUpProblem {
  return stepUpProblem(err instanceof ApiRequestError ? err : null);
}

function post<T>(path: string, body: object): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

function Problem({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="text-sm font-medium text-danger-strong">
      {text}
    </p>
  ) : null;
}

/**
 * /admin/security: turn two-factor login on (password, QR code, first code, recovery codes), make new recovery codes,
 * or turn it off. The API decides everything; enabling and disabling set new session cookies, so the page loads
 * again afterwards (the admin pages read the new session).
 */
export function TwoFactorSettings({ locale, status }: { locale: Locale; status: TwoFactorStatus }) {
  const m = pick(adminSecurityMessages, locale);
  return status.enabled ? (
    <EnabledView m={m} locale={locale} remaining={status.recoveryCodesRemaining} />
  ) : (
    <SetupFlow m={m} />
  );
}

function SetupFlow({ m }: { m: AdminSecurityMessages }) {
  const hydrated = useHydrated();
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState<{ qr: string | null; key: string | null } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const out = await post<{ otpauthUri: string; qrDataUri: string }>('/auth/2fa/setup', {
        password,
      });
      setPassword('');
      setSecret({
        qr: QR_DATA_URI.test(out.qrDataUri) ? out.qrDataUri : null,
        key: manualKeyFrom(out.otpauthUri),
      });
    } catch (err) {
      setError(m.problems[problemOf(err)]);
    }
    setBusy(false);
  }

  async function enable(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const totp = totpFrom(code);
    if (!totp) {
      setError(m.invalidCode);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const out = await post<{ recoveryCodes: string[] }>('/auth/2fa/enable', { code: totp });
      setCodes(out.recoveryCodes);
    } catch (err) {
      const problem = problemOf(err);
      if (problem === 'setupAgain') setSecret(null);
      if (problem === 'wrongCode') setCode('');
      setError(m.problems[problem]);
    }
    setBusy(false);
  }

  // Enabled: this browser now holds a session with the proved factor; the admin pages open after the codes.
  if (codes)
    return <RecoveryCodes m={m} codes={codes} onDone={() => window.location.replace('/admin')} />;

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-lg font-bold text-ink">{m.setup.title}</h2>
      {!secret ? (
        <form method="post" onSubmit={start} className="flex max-w-md flex-col gap-4">
          <p className="text-sm text-ink-muted">{m.setup.step1}</p>
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
          <Problem text={error} />
          <Button type="submit" loading={busy} loadingLabel={m.working} disabled={!hydrated}>
            {m.setup.start}
          </Button>
        </form>
      ) : (
        <form method="post" onSubmit={enable} className="flex max-w-md flex-col gap-4">
          <p className="text-sm text-ink-muted">{m.setup.step2}</p>
          {secret.qr ? (
            // A data URI from the API, not a remote image: next/image adds nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={secret.qr}
              alt={m.setup.qrAlt}
              width={200}
              height={200}
              className="rounded-lg border border-line bg-white p-2"
            />
          ) : null}
          {secret.key ? (
            <div className="text-sm text-ink-muted">
              <p>{m.setup.manual}</p>
              <p className="mt-1 font-mono text-base font-semibold tracking-wider text-ink">
                {secret.key}
              </p>
            </div>
          ) : null}
          <p className="text-sm text-ink-muted">{m.setup.step3}</p>
          <Field
            label={m.code}
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
          <Problem text={error} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={busy} loadingLabel={m.working} disabled={!hydrated}>
              {m.setup.enable}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setSecret(null);
                setCode('');
                setError('');
              }}
            >
              {m.setup.startOver}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function RecoveryCodes({
  m,
  codes,
  onDone,
}: {
  m: AdminSecurityMessages;
  codes: string[];
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      /* no clipboard access (an old browser, or not allowed): the codes stay on screen to write down */
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-ink">{m.codes.title}</h2>
      <p className="text-sm text-ink-muted">{m.codes.text}</p>
      <ol className="grid max-w-md grid-cols-2 gap-2 font-mono text-base font-semibold tracking-wider text-ink">
        {codes.map((c) => (
          <li key={c} className="rounded-md border border-line px-3 py-2 text-center">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? m.codes.copied : m.codes.copy}
        </Button>
        <Button type="button" onClick={onDone}>
          {m.codes.done}
        </Button>
      </div>
    </Card>
  );
}

function EnabledView({
  m,
  locale,
  remaining,
}: {
  m: AdminSecurityMessages;
  locale: Locale;
  remaining: number;
}) {
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) return <RecoveryCodes m={m} codes={codes} onDone={() => window.location.reload()} />;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          {m.statusLabel} <Badge tone="success">{m.on}</Badge>
        </p>
        <p className="text-sm text-ink-muted">{m.recoveryLeft(formatNumber(locale, remaining))}</p>
        {remaining <= LOW_RECOVERY ? (
          <p className="text-sm font-medium text-warning-strong">{m.recoveryLow}</p>
        ) : null}
      </Card>
      <RenewCodes m={m} onCodes={setCodes} />
      <DisableForm m={m} />
    </div>
  );
}

function RenewCodes({ m, onCodes }: { m: AdminSecurityMessages; onCodes: (c: string[]) => void }) {
  const hydrated = useHydrated();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const totp = totpFrom(code);
    if (!totp) {
      setError(m.invalidCode);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const out = await post<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', {
        code: totp,
      });
      onCodes(out.recoveryCodes);
      return;
    } catch (err) {
      const problem = problemOf(err);
      if (problem === 'wrongCode') setCode('');
      setError(m.problems[problem]);
    }
    setBusy(false);
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-ink">{m.renew.title}</h2>
      <p className="text-sm text-ink-muted">{m.renew.text}</p>
      <form method="post" onSubmit={submit} className="flex max-w-md flex-col gap-4">
        <Field
          label={m.code}
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
        <Problem text={error} />
        <Button
          type="submit"
          variant="secondary"
          loading={busy}
          loadingLabel={m.working}
          disabled={!hydrated}
        >
          {m.renew.submit}
        </Button>
      </form>
    </Card>
  );
}

function DisableForm({ m }: { m: AdminSecurityMessages }) {
  const hydrated = useHydrated();
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const factor = recovery ? recoveryCodeFrom(code) : totpFrom(code);
    if (!factor) {
      setError(recovery ? m.invalidRecovery : m.invalidCode);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await post(
        '/auth/2fa/disable',
        recovery ? { password, recoveryCode: factor } : { password, code: factor },
      );
      // A new session without the factor: an admin or manager lands on this page again, to enrol.
      window.location.replace(TWO_FACTOR_PAGE);
      return;
    } catch (err) {
      const problem = problemOf(err);
      if (problem === 'wrongCode') setCode('');
      setError(m.problems[problem]);
    }
    setBusy(false);
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-bold text-ink">{m.disable.title}</h2>
      <p className="text-sm text-ink-muted">{m.disable.text}</p>
      <form method="post" onSubmit={submit} className="flex max-w-md flex-col gap-4">
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
        <Field
          key={recovery ? 'recovery' : 'app'}
          label={recovery ? m.recoveryCode : m.code}
          name={recovery ? 'recoveryCode' : 'code'}
          type="text"
          inputMode={recovery ? 'text' : 'numeric'}
          autoComplete={recovery ? 'off' : 'one-time-code'}
          autoCapitalize={recovery ? 'characters' : 'off'}
          spellCheck={false}
          required
          maxLength={recovery ? 20 : 9}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          icon={<KeyRound size={18} />}
        />
        <button
          type="button"
          onClick={() => {
            setRecovery(!recovery);
            setCode('');
            setError('');
          }}
          className="self-start text-sm font-semibold text-secondary hover:underline"
        >
          {recovery ? m.useApp : m.useRecovery}
        </button>
        <Problem text={error} />
        <Button
          type="submit"
          variant="danger"
          loading={busy}
          loadingLabel={m.working}
          disabled={!hydrated}
        >
          {m.disable.submit}
        </Button>
      </form>
    </Card>
  );
}
