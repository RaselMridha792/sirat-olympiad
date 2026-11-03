'use client';
import { useState } from 'react';
import { Ban } from 'lucide-react';
import { CERTIFICATE_LIMITS as L, CERTIFICATE_REFUSALS } from '@sirat/shared';
import { Button, Dialog, Field } from '@sirat/ui';
import { useCall } from '@/components/admin/rounds/use-call';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { certificatesMessages } from '@/i18n/messages/certificates';

/** Revoke one certificate with a reason (core C6c-1): POST /api/admin/certificates/:id/revoke, audited. */
export function RevokeButton({
  locale,
  id,
  serial,
  updatedAt,
}: {
  locale: Locale;
  id: string;
  serial: string;
  updatedAt: string;
}) {
  const m = pick(certificatesMessages, locale);
  const { pending, problem, setProblem, run } = useCall(CERTIFICATE_REFUSALS);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const why = reason.trim();
    if (why.length < L.reasonMin || why.length > L.reasonMax) return setProblem('invalid');
    const done = await run(`/admin/certificates/${encodeURIComponent(id)}/revoke`, 'POST', {
      reason: why,
      expectedUpdatedAt: updatedAt,
    });
    if (done) setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setProblem(null);
          setReason('');
          setOpen(true);
        }}
      >
        <Ban aria-hidden="true" size={16} />
        {m.admin.revoke.button}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={m.admin.revoke.title(serial)}
        closeLabel={m.cancel}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{m.admin.revoke.text}</p>
          <Field
            id={`revoke-reason-${id}`}
            name="reason"
            label={m.admin.revoke.reason}
            maxLength={L.reasonMax}
            autoComplete="off"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem as keyof typeof m.errors] ?? m.errors.failed}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? m.pending : m.admin.revoke.submit}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
