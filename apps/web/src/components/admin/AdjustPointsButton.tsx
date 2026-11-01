'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';
import { AMBASSADOR_POINTS_LIMITS as L, type PointsAdjustResult } from '@sirat/shared';
import { Button, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminAmbassadorsMessages } from '@/i18n/messages/admin-ambassadors';
import { api, SessionExpiredError } from '@/lib/api';
import { pointsProblem, type PointsProblem } from './points-problem';

/**
 * "Adjust points" (core C5b): a compensating entry through POST /api/admin/points/adjust. Points are a ledger, so a
 * correction is a new row (plus or minus), never an edit; the server records the admin and the reason.
 */
export function AdjustPointsButton({ locale, userId }: { locale: Locale; userId: string }) {
  const m = pick(adminAmbassadorsMessages, locale).adjust;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<PointsProblem | null>(null);

  function close() {
    if (pending) return;
    setOpen(false);
    setProblem(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const value = Number(amount.replace('−', '-').trim());
    const text = reason.trim();
    if (
      !Number.isInteger(value) ||
      value === 0 ||
      Math.abs(value) > L.maxAdjust ||
      text.length < L.reasonMin ||
      text.length > L.reasonMax
    ) {
      setProblem('invalid');
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      await api<PointsAdjustResult>('/admin/points/adjust', {
        method: 'POST',
        body: JSON.stringify({ userId, amount: value, reason: text }),
      });
      setOpen(false);
      setAmount('');
      setReason('');
      router.refresh();
    } catch (error) {
      if (error instanceof SessionExpiredError) return;
      setProblem(pointsProblem(error));
    } finally {
      setPending(false);
    }
  }

  const message =
    problem === 'notAmbassador'
      ? m.errors.notAmbassador
      : problem === 'invalid'
        ? m.errors.invalid
        : problem
          ? m.errors.failed
          : null;
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden="true" size={16} />
        {m.button}
      </Button>
      <Dialog open={open} onClose={close} title={m.title} closeLabel={m.cancel}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{m.text}</p>
          <Field
            id={`adjust-amount-${userId}`}
            name="amount"
            label={m.amount}
            inputMode="numeric"
            value={amount}
            autoComplete="off"
            onChange={(e) => setAmount(e.target.value)}
          />
          <Field
            id={`adjust-reason-${userId}`}
            name="reason"
            label={m.reason}
            value={reason}
            maxLength={L.reasonMax}
            autoComplete="off"
            onChange={(e) => setReason(e.target.value)}
          />
          {message ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? m.pending : m.confirm}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
