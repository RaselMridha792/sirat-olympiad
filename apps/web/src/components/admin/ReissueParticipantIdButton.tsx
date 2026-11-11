'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminParticipantIdMessages } from '@/i18n/messages/admin-participant-id';
import { api, SessionExpiredError } from '@/lib/api';
import { participantIdProblem, type ParticipantIdProblem } from './participant-id-problem';

type ReissueResult = { reissued: true; sessionsEnded: number; emailQueued: boolean };

/**
 * "Issue a new participant ID" in the student's detail dialog (payments P1b): POST /api/admin/users/:id/participant-id
 * through api(), with a reason. The answer never carries the ID (it goes to the student's email only), so this only
 * says that it went and how many sessions ended.
 */
export function ReissueParticipantIdButton({ locale, userId }: { locale: Locale; userId: string }) {
  const m = pick(adminParticipantIdMessages, locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ParticipantIdProblem | null>(null);
  const [done, setDone] = useState('');

  function close() {
    if (pending) return;
    setOpen(false);
    setProblem(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const text = reason.trim();
    if (text.length < 10 || text.length > 200) {
      setProblem('reason');
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const result = await api<ReissueResult>(
        `/admin/users/${encodeURIComponent(userId)}/participant-id`,
        { method: 'POST', body: JSON.stringify({ reason: text }) },
      );
      setOpen(false);
      setReason('');
      setDone(result.emailQueued ? m.done(result.sessionsEnded) : m.doneNoEmail);
      router.refresh();
    } catch (error) {
      if (error instanceof SessionExpiredError) return;
      setProblem(participantIdProblem(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setDone('');
          setOpen(true);
        }}
      >
        {m.button}
      </Button>
      {done ? (
        <p role="status" className="mt-2 text-sm text-ink-muted">
          {done}
        </p>
      ) : null}
      <Dialog open={open} onClose={close} title={m.title} closeLabel={m.cancel}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{m.intro}</p>
          <Field
            id="participant-id-reason"
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
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? m.pending : m.submit}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
