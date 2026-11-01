'use client';
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { TASK_LIMITS as L, type TaskReviewResult } from '@sirat/shared';
import { Button, Dialog, Field } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { adminTasksMessages } from '@/i18n/messages/admin-tasks';
import { useTaskAction } from './use-task-action';

/** Approve (final; awards the task's points once) or reject with a note (the ambassador may send again). */
export function TaskDecision({
  locale,
  assignmentId,
  points,
}: {
  locale: Locale;
  assignmentId: string;
  points: number;
}) {
  const m = pick(adminTasksMessages, locale);
  const d = m.decision;
  const { pending, problem, setProblem, run } = useTaskAction();
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const path = `/admin/task-assignments/${encodeURIComponent(assignmentId)}`;

  function start(next: 'approve' | 'reject') {
    setProblem(null);
    setNote('');
    setMode(next);
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (mode === 'reject') {
      const text = note.trim();
      if (text.length < L.noteMin || text.length > L.noteMax) {
        setProblem('invalid');
        return;
      }
      if (await run<TaskReviewResult>(`${path}/reject`, 'POST', { note: text })) setMode(null);
    } else if (mode === 'approve') {
      if (await run<TaskReviewResult>(`${path}/approve`, 'POST')) setMode(null);
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button type="button" variant="outline" size="sm" onClick={() => start('approve')}>
        <Check aria-hidden="true" size={16} />
        {d.approve}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => start('reject')}>
        <X aria-hidden="true" size={16} />
        {d.reject}
      </Button>
      <Dialog
        open={mode !== null}
        onClose={() => !pending && setMode(null)}
        title={mode === 'reject' ? d.rejectTitle : d.approveTitle}
        closeLabel={m.cancel}
      >
        <form onSubmit={confirm} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">
            {mode === 'reject' ? d.rejectText : d.approveText(formatNumber(locale, points))}
          </p>
          {mode === 'reject' ? (
            <Field
              id={`task-note-${assignmentId}`}
              name="note"
              label={d.note}
              value={note}
              maxLength={L.noteMax}
              autoComplete="off"
              onChange={(e) => setNote(e.target.value)}
            />
          ) : null}
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" variant={mode === 'reject' ? 'danger' : 'primary'} disabled={pending}>
              {pending ? m.pending : mode === 'reject' ? d.confirmReject : d.confirmApprove}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
