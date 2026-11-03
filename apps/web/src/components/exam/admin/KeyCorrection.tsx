'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { KEY_CORRECTION_LIMITS } from '@sirat/shared';
import { Button, cn, Dialog, TextAreaField } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminExamAuthoringMessages } from '@/i18n/messages/admin-exam-authoring';
import { api } from '@/lib/api';
import {
  authoringProblems,
  keyCorrectionBody,
  reasonProblem,
  type AuthoringProblem,
} from './exam-authoring';

/**
 * "Correct the key" for one question of a published exam whose results are not published (E7b). The question itself
 * never changes: the server stores the correction, every scored attempt is re-scored by a job, and the results panel
 * shows the change and its count before Build and Publish. Sends the exam's `updatedAt`, so a correction made
 * elsewhere since the page loaded is refused as `stale`.
 */
export function KeyCorrectionButton({
  locale,
  examId,
  examUpdatedAt,
  question,
  number,
}: {
  locale: Locale;
  examId: string;
  examUpdatedAt: string;
  /** `correctKey` is the key in effect now (after any earlier correction). */
  question: { id: string; options: Array<{ key: string; text: string }>; correctKey: string };
  /** The question's number in the list, already formatted. */
  number: string;
}) {
  const m = pick(adminExamAuthoringMessages, locale);
  const d = m.questions.correction;
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [toKey, setToKey] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [refused, setRefused] = useState<AuthoringProblem[]>([]);
  const formId = `key-correction-${question.id}`;
  const problem = checked ? reasonProblem(reason) : null;
  const keyMissing = checked && toKey === null;

  function close() {
    if (pending) return;
    setOpen(false);
    setToKey(null);
    setReason('');
    setChecked(false);
    setRefused([]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setChecked(true);
    setRefused([]);
    if (toKey === null || reasonProblem(reason)) return;
    setPending(true);
    try {
      await api(
        `/admin/exams/${encodeURIComponent(examId)}/questions/${encodeURIComponent(question.id)}/key-corrections`,
        {
          method: 'POST',
          body: JSON.stringify(keyCorrectionBody(toKey, reason, examUpdatedAt)),
        },
      );
      setPending(false);
      close();
      router.refresh();
    } catch (failure) {
      setRefused(authoringProblems(failure));
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!hydrated}
        aria-label={d.buttonLabel(number)}
        onClick={() => setOpen(true)}
      >
        <span className="inline-flex items-center gap-2">
          <KeyRound size={14} aria-hidden="true" />
          {d.button}
        </span>
      </Button>
      {open ? (
        <Dialog
          open
          onClose={close}
          title={d.title(number)}
          closeLabel={m.state.cancel}
          footer={
            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="ghost" disabled={pending} onClick={close}>
                {m.state.cancel}
              </Button>
              <Button type="submit" form={formId} loading={pending} loadingLabel={m.state.busy}>
                {d.save}
              </Button>
            </div>
          }
        >
          <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="space-y-5">
            <p
              role="note"
              className="rounded-control bg-warning-soft p-3 text-sm text-warning-strong"
            >
              {d.note}
            </p>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-ink">
                {d.current(question.correctKey)}
              </legend>
              <p className="text-xs text-ink-faint">{d.pick}</p>
              {question.options
                .filter((o) => o.key !== question.correctKey)
                .map((option) => (
                  <label
                    key={option.key}
                    className={cn(
                      'flex items-center gap-3 rounded-control border bg-page px-3 py-2 text-sm text-ink',
                      toKey === option.key ? 'border-success' : 'border-line',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${formId}-key`}
                      checked={toKey === option.key}
                      disabled={pending}
                      onChange={() => setToKey(option.key)}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="w-6 shrink-0 font-bold text-ink-muted">{option.key}</span>
                    <span className="min-w-0 flex-1 break-words">{option.text}</span>
                  </label>
                ))}
              {keyMissing ? (
                <p className="text-xs font-medium text-danger-strong">{d.keyMissing}</p>
              ) : null}
            </fieldset>
            <TextAreaField
              id={`${formId}-reason`}
              label={d.reason}
              rows={3}
              value={reason}
              maxLength={KEY_CORRECTION_LIMITS.reasonMax}
              disabled={pending}
              hint={d.reasonHint}
              error={problem ? d[problem] : undefined}
              onChange={(e) => setReason(e.target.value)}
            />
            {refused.length ? (
              <ul
                role="alert"
                className="list-disc space-y-1 ps-5 text-sm font-semibold text-danger-strong"
              >
                {refused.map((code) => (
                  <li key={code}>{m.errors[code]}</li>
                ))}
              </ul>
            ) : null}
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
