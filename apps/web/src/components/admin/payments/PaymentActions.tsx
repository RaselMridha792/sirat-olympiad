'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { ADMIN_SETTING_LIMITS } from '@sirat/shared';
import { Button, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminPaymentsMessages } from '@/i18n/messages/admin-payments';
import { api, ApiRequestError, SessionExpiredError } from '@/lib/api';
import { actionProblem, validReason, validTrxId, type ActionProblem } from './admin-payment-rules';

const answerOf = (err: unknown) =>
  err instanceof ApiRequestError ? { status: err.status, body: err.body } : null;

/**
 * The detail dialog's actions (06-API "Admin payments and settings"):
 * - "Ask PayStation again": POST /admin/payments/:id/recheck (the worker asks; audited; once per 10 s);
 * - "Mark as paid": POST /admin/payments/:id/reconcile, offered only when the automatic check stopped on a success
 *   without a trx_id (lead, 2026-10-31). The API checks the rule again under the row lock; the page then reloads.
 */
export function PaymentActions({
  locale,
  paymentId,
  canReconcile,
}: {
  locale: Locale;
  paymentId: string;
  canReconcile: boolean;
}) {
  const m = pick(adminPaymentsMessages, locale);
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [trxId, setTrxId] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<ActionProblem | 'trxId' | 'reason' | null>(null);
  const [saving, setSaving] = useState(false);
  const r = m.reconcile;
  const path = `/admin/payments/${encodeURIComponent(paymentId)}`;

  async function recheck() {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      const out = await api<{ requested: boolean }>(`${path}/recheck`, { method: 'POST' });
      setNote(out.requested ? m.recheck.sent : m.recheck.throttled);
    } catch (err) {
      if (err instanceof SessionExpiredError) return; // api() is taking the browser to /login
      setNote(m.recheck.failed);
    }
    setBusy(false);
  }

  function close() {
    if (saving) return;
    setOpen(false);
    setProblem(null);
  }

  async function reconcile(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!validTrxId(trxId)) return setProblem('trxId');
    if (
      !validReason(
        reason,
        ADMIN_SETTING_LIMITS.reconcileReasonMin,
        ADMIN_SETTING_LIMITS.reconcileReasonMax,
      )
    )
      return setProblem('reason');
    setSaving(true);
    setProblem(null);
    try {
      const out = await api<{ applied: boolean }>(`${path}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({ trxId: trxId.trim(), reason: reason.trim() }),
      });
      setOpen(false);
      setNote(out.applied ? r.done : r.already);
      router.refresh();
    } catch (err) {
      if (err instanceof SessionExpiredError) return;
      setProblem(actionProblem(answerOf(err)));
    }
    setSaving(false);
  }

  // A 400 means the API refused the form itself (the browser checks the same rules first).
  const shown =
    !problem || problem === 'trxId' || problem === 'reason'
      ? null
      : problem === 'invalid' || problem === 'SETTING_CHANGED'
        ? r.errors.trxId
        : r.errors[problem];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={recheck}>
          <RefreshCw aria-hidden="true" size={16} />
          {m.recheck.button}
        </Button>
        {canReconcile ? (
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            {r.open}
          </Button>
        ) : null}
      </div>
      {note ? (
        <p role="status" className="text-sm text-ink-muted">
          {note}
        </p>
      ) : null}
      <Dialog open={open} onClose={close} title={r.title} closeLabel={r.cancel}>
        <form onSubmit={reconcile} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{r.intro}</p>
          <Field
            id="reconcile-trx"
            name="trxId"
            label={r.trxId}
            hint={r.trxIdHint}
            value={trxId}
            maxLength={64}
            autoComplete="off"
            onChange={(e) => setTrxId(e.target.value)}
            error={problem === 'trxId' ? r.errors.trxId : undefined}
          />
          <Field
            id="reconcile-reason"
            name="reason"
            label={r.reason}
            hint={r.reasonHint}
            value={reason}
            maxLength={ADMIN_SETTING_LIMITS.reconcileReasonMax}
            autoComplete="off"
            onChange={(e) => setReason(e.target.value)}
            error={problem === 'reason' ? r.errors.reason : undefined}
          />
          {shown ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {shown}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={saving}>
              {r.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? r.pending : r.submit}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
