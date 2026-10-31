'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Power } from 'lucide-react';
import { ADMIN_SETTING_LIMITS, type AdminSettingKey } from '@sirat/shared';
import { Button, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { adminSettingsMessages } from '@/i18n/messages/admin-payments';
import { api, ApiRequestError, SessionExpiredError } from '@/lib/api';
import {
  actionProblem,
  parseFeeTaka,
  validReason,
  type ActionProblem,
} from './admin-payment-rules';

const answerOf = (err: unknown) =>
  err instanceof ApiRequestError ? { status: err.status, body: err.body } : null;

/** PUT /admin/settings/:key with the value the page showed as `expected`: an old page never overwrites a newer change. */
function putSetting(key: AdminSettingKey, value: unknown, expected: unknown, reason?: string) {
  return api(`/admin/settings/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value, expected, ...(reason ? { reason } : {}) }),
  });
}

/**
 * "Change the fee" (plan 3.4): the admin types whole taka; the dialog shows the old and the new value side by side
 * (৳400 → ৳450), says that payments already started keep their amount, and requires a reason. A 409 means someone
 * changed the fee meanwhile: the admin reloads and starts again.
 */
export function FeeDialog({ locale, currentMinor }: { locale: Locale; currentMinor: number }) {
  const m = pick(adminSettingsMessages, locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [taka, setTaka] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<ActionProblem | 'amount' | 'same' | 'reason' | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const f = m.fee;
  const next = parseFeeTaka(taka);
  const money = (minor: number) => formatNumber(locale, minor / 100);

  function close() {
    if (saving) return;
    setOpen(false);
    setProblem(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (next === null) return setProblem('amount');
    if (next === currentMinor) return setProblem('same');
    if (!validReason(reason, ADMIN_SETTING_LIMITS.reasonMin, ADMIN_SETTING_LIMITS.reasonMax))
      return setProblem('reason');
    setSaving(true);
    setProblem(null);
    try {
      await putSetting('registration_fee_minor', next, currentMinor, reason.trim());
      setOpen(false);
      setTaka('');
      setReason('');
      setDone(true);
      router.refresh();
    } catch (err) {
      if (err instanceof SessionExpiredError) return; // api() is taking the browser to /login
      setProblem(actionProblem(answerOf(err)));
    }
    setSaving(false);
  }

  const formError =
    problem && problem !== 'amount' && problem !== 'same' && problem !== 'reason'
      ? m.errors[
          problem === 'RECONCILE_NOT_ALLOWED' || problem === 'TRX_ID_IN_USE' ? 'invalid' : problem
        ]
      : null;

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setDone(false);
          setOpen(true);
        }}
      >
        <Pencil aria-hidden="true" size={16} />
        {f.button}
      </Button>
      {done ? (
        <p role="status" className="text-xs text-ink-muted">
          {f.done}
        </p>
      ) : null}
      <Dialog open={open} onClose={close} title={f.title} closeLabel={f.cancel}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">
            {f.current}: <strong className="text-ink">৳{money(currentMinor)}</strong>
          </p>
          <Field
            id="fee-taka"
            name="fee"
            label={f.next}
            hint={f.hint}
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={taka}
            onChange={(e) => setTaka(e.target.value)}
            error={
              problem === 'amount'
                ? m.errors.amount
                : problem === 'same'
                  ? m.errors.same
                  : undefined
            }
          />
          {next !== null && next !== currentMinor ? (
            <p
              className="rounded-control bg-page p-3 text-center text-lg font-bold text-ink"
              aria-live="polite"
            >
              {f.compare(money(currentMinor), money(next))}
            </p>
          ) : null}
          <p className="text-sm text-ink-muted">{f.note}</p>
          <Field
            id="fee-reason"
            name="reason"
            label={f.reason}
            hint={f.reasonHint}
            maxLength={ADMIN_SETTING_LIMITS.reasonMax}
            autoComplete="off"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={problem === 'reason' ? m.errors.reason : undefined}
          />
          {formError ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {formError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={saving}>
              {f.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? f.pending : f.confirm}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** Opens or closes registration after a confirmation (PUT registration_open with `expected`). */
export function RegistrationSwitch({ locale, open }: { locale: Locale; open: boolean }) {
  const m = pick(adminSettingsMessages, locale);
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<ActionProblem | null>(null);
  const s = m.switch;

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setProblem(null);
    try {
      await putSetting('registration_open', !open, open);
      setAsking(false);
      router.refresh();
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      setProblem(actionProblem(answerOf(err)));
    }
    setSaving(false);
  }

  const shown =
    problem === 'RECONCILE_NOT_ALLOWED' || problem === 'TRX_ID_IN_USE' ? 'invalid' : problem;

  return (
    <>
      <Button
        type="button"
        variant={open ? 'danger' : 'primary'}
        size="sm"
        onClick={() => {
          setProblem(null);
          setAsking(true);
        }}
      >
        <Power aria-hidden="true" size={16} />
        {open ? s.close : s.open}
      </Button>
      <Dialog
        open={asking}
        onClose={() => (saving ? undefined : setAsking(false))}
        title={open ? s.titleClose : s.titleOpen}
        closeLabel={s.cancel}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{open ? s.textClose : s.textOpen}</p>
          {shown ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[shown]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAsking(false)}
              disabled={saving}
            >
              {s.cancel}
            </Button>
            <Button
              type="button"
              variant={open ? 'danger' : 'primary'}
              onClick={confirm}
              disabled={saving}
            >
              {saving ? s.pending : s.confirm}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
