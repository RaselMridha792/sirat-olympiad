'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { Button, buttonClasses, Dialog } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminExamAuthoringMessages } from '@/i18n/messages/admin-exam-authoring';
import { api } from '@/lib/api';
import {
  authoringProblems,
  stateActions,
  type AuthoringProblem,
  type ExamSettings,
} from './exam-authoring';

type Action = ReturnType<typeof stateActions>[number];

/**
 * "Edit settings", and publish, unpublish and archive, each after a confirm dialog. They send the exam's
 * `updatedAt`, so a change made elsewhere since the page loaded is refused as `stale`. A refusal lists every check
 * the server failed (publish can fail several at once).
 */
export function ExamStateActions({ locale, exam }: { locale: Locale; exam: ExamSettings }) {
  const m = pick(adminExamAuthoringMessages, locale);
  const s = m.state;
  const router = useRouter();
  const hydrated = useHydrated();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [refused, setRefused] = useState<AuthoringProblem[]>([]);

  async function run(action: Action) {
    setConfirm(null);
    setBusy(action);
    setRefused([]);
    try {
      await api(`/admin/exams/${encodeURIComponent(exam.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ expectedUpdatedAt: exam.updatedAt }),
      });
      router.refresh();
    } catch (failure) {
      setRefused(authoringProblems(failure));
    } finally {
      setBusy(null);
    }
  }

  const actions = stateActions(exam);
  const idle = hydrated && busy === null;
  const dialog = confirm ? s.confirm[confirm] : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {exam.status !== 'archived' ? (
          <Link
            href={`/admin/exams/${encodeURIComponent(exam.id)}/edit`}
            className={buttonClasses({ variant: 'outline' })}
          >
            <span className="inline-flex items-center gap-2">
              <Pencil size={16} aria-hidden="true" />
              {m.editSettings}
            </span>
          </Link>
        ) : null}
        {actions.map((action) => (
          <Button
            key={action}
            variant={action === 'publish' ? 'primary' : 'outline'}
            disabled={!idle}
            loading={busy === action}
            loadingLabel={s.busy}
            onClick={() => setConfirm(action)}
          >
            {s[action]}
          </Button>
        ))}
      </div>
      {refused.length > 0 ? (
        <div role="alert" className="text-sm font-semibold text-danger-strong">
          <p>{s.refusedHeading}</p>
          <ul className="mt-1 list-disc space-y-1 ps-5">
            {refused.map((code) => (
              <li key={code}>{m.errors[code]}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Dialog
        open={dialog !== null}
        onClose={() => setConfirm(null)}
        title={dialog?.title ?? ''}
        closeLabel={s.cancel}
        footer={
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {s.cancel}
            </Button>
            <Button
              variant={confirm === 'publish' ? 'primary' : 'danger'}
              onClick={() => confirm && void run(confirm)}
            >
              {dialog?.button}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink">{dialog?.body}</p>
      </Dialog>
    </div>
  );
}
