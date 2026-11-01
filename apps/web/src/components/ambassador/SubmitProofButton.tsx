'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { TASK_LIMITS as L } from '@sirat/shared';
import { Button, Dialog, TextAreaField } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { ambassadorMessages } from '@/i18n/messages/ambassador';
import { api, SessionExpiredError } from '@/lib/api';
import { taskProblem } from '../admin/task-problem';

type Problem = 'invalid' | 'notOpen' | 'archived' | 'limit' | 'failed';

/**
 * "Send proof" for one of the ambassador's own tasks (core C5b-2): POST /api/ambassador/tasks/:id/submit through api().
 * Plain text only; the server never logs or audits it, and the panel never shows it back.
 */
export function SubmitProofButton({
  locale,
  assignmentId,
  again,
}: {
  locale: Locale;
  assignmentId: string;
  again: boolean;
}) {
  const m = pick(ambassadorMessages, locale).tasks;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const text = proof.trim();
    if (text.length < 1 || text.length > L.proofMax) {
      setProblem('invalid');
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      await api(`/ambassador/tasks/${encodeURIComponent(assignmentId)}/submit`, {
        method: 'POST',
        body: JSON.stringify({ proof: text }),
      });
      setOpen(false);
      setProof('');
      router.refresh();
    } catch (error) {
      if (error instanceof SessionExpiredError) return;
      const p = taskProblem(error);
      setProblem(
        p === 'notOpen' || p === 'archived' || p === 'limit' || p === 'invalid' ? p : 'failed',
      );
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
          setProblem(null);
          setOpen(true);
        }}
      >
        <Send aria-hidden="true" size={16} />
        {again ? m.submitAgain : m.submit}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={m.submitTitle}
        closeLabel={m.cancel}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{m.submitText}</p>
          <TextAreaField
            id={`proof-${assignmentId}`}
            name="proof"
            label={m.proof}
            value={proof}
            maxLength={L.proofMax}
            rows={5}
            onChange={(e) => setProof(e.target.value)}
          />
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? m.pending : m.send}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
