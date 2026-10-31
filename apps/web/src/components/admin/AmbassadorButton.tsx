'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, BadgeX } from 'lucide-react';
import type { AmbassadorState } from '@sirat/shared';
import { Button, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminAmbassadorsMessages } from '@/i18n/messages/admin-ambassadors';
import { api, SessionExpiredError } from '@/lib/api';
import { ambassadorProblem, type AmbassadorProblem } from './ambassador-problem';

/**
 * "Make ambassador" / "Revoke ambassador" (core C5a): a confirmation with a reason, then
 * POST /api/admin/ambassadors/:userId/{approve,revoke} through api(). The server assigns the code and records the
 * reason; the code changes no fee.
 */
export function AmbassadorButton({
  locale,
  userId,
  action,
}: {
  locale: Locale;
  userId: string;
  action: 'approve' | 'revoke';
}) {
  const m = pick(adminAmbassadorsMessages, locale).action;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<AmbassadorProblem | null>(null);

  function close() {
    if (pending) return;
    setOpen(false);
    setProblem(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const text = reason.trim();
    if (text.length < 3 || text.length > 200) {
      setProblem('reason');
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      await api<AmbassadorState>(`/admin/ambassadors/${encodeURIComponent(userId)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: text }),
      });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (error) {
      if (error instanceof SessionExpiredError) return;
      setProblem(ambassadorProblem(error));
    } finally {
      setPending(false);
    }
  }

  const approve = action === 'approve';
  return (
    <>
      <Button
        type="button"
        variant={approve ? 'outline' : 'ghost'}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {approve ? (
          <BadgeCheck aria-hidden="true" size={16} />
        ) : (
          <BadgeX aria-hidden="true" size={16} />
        )}
        {approve ? m.approve : m.revoke}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={approve ? m.approveTitle : m.revokeTitle}
        closeLabel={m.cancel}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{approve ? m.approveText : m.revokeText}</p>
          <p className="text-xs text-ink-faint">{m.lag}</p>
          <Field
            id={`ambassador-reason-${userId}`}
            name="reason"
            label={m.reason}
            value={reason}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => setReason(e.target.value)}
            error={problem === 'reason' ? m.errors.reason : undefined}
          />
          {problem && problem !== 'reason' ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" variant={approve ? 'primary' : 'danger'} disabled={pending}>
              {pending ? m.pending : m.confirm}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
