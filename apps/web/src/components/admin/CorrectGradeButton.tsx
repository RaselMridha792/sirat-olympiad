'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StudentProfile } from '@sirat/shared';
import { Button, Dialog, Field, SelectField } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminUsersMessages } from '@/i18n/messages/admin-users';
import { api, SessionExpiredError } from '@/lib/api';
import { gradeProblem, type GradeProblem } from './grade-problem';

/**
 * "Correct grade level" in the student's detail dialog (core plan Q1): POST /api/admin/users/:id/grade-level through
 * api(), with a reason. The server refuses it once the student has an exam attempt and records the old and the new
 * class with the reason; the category follows the grade table.
 */
export function CorrectGradeButton({
  locale,
  userId,
  currentGradeId,
  gradeLevels,
}: {
  locale: Locale;
  userId: string;
  currentGradeId: string | null;
  gradeLevels: Array<{ id: string; label: string }>;
}) {
  const m = pick(adminUsersMessages, locale).grade;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [gradeLevelId, setGradeLevelId] = useState(currentGradeId ?? '');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<GradeProblem | null>(null);

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
      await api<StudentProfile>(`/admin/users/${encodeURIComponent(userId)}/grade-level`, {
        method: 'POST',
        body: JSON.stringify({ gradeLevelId, reason: text }),
      });
      setOpen(false);
      setReason('');
      router.refresh(); // the dialog shows the new class and category from the server
    } catch (error) {
      if (error instanceof SessionExpiredError) return;
      setProblem(gradeProblem(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {m.button}
      </Button>
      <Dialog open={open} onClose={close} title={m.title} closeLabel={m.cancel}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{m.intro}</p>
          <SelectField
            id="grade-correction-level"
            name="gradeLevelId"
            label={m.label}
            value={gradeLevelId}
            onChange={(e) => setGradeLevelId(e.target.value)}
            options={gradeLevels.map((g) => ({ value: g.id, label: g.label }))}
            error={problem === 'unknown' ? m.errors.unknown : undefined}
          />
          <Field
            id="grade-correction-reason"
            name="reason"
            label={m.reason}
            value={reason}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => setReason(e.target.value)}
            error={problem === 'reason' ? m.errors.reason : undefined}
          />
          {problem && problem !== 'reason' && problem !== 'unknown' ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={pending || gradeLevelId === currentGradeId}>
              {pending ? m.pending : m.submit}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
