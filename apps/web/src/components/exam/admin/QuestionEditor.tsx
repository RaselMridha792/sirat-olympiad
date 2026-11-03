'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { EXAM_LIMITS } from '@sirat/shared';
import { Button, cn, Dialog, TextAreaField } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { pick, type Messages } from '@/i18n/messages';
import { adminExamAuthoringMessages } from '@/i18n/messages/admin-exam-authoring';
import { api } from '@/lib/api';
import {
  addOption,
  authoringProblems,
  hasQuestionProblems,
  optionKey,
  questionBody,
  questionProblems,
  removeOption,
  toQuestionValues,
  type AuthoringProblem,
  type EditableQuestion,
  type QuestionFormValues,
  type QuestionRules,
} from './exam-authoring';

type M = Messages<typeof adminExamAuthoringMessages>;

const questionsPath = (examId: string) => `/admin/exams/${encodeURIComponent(examId)}/questions`;

function Refusals({ m, codes }: { m: M; codes: AuthoringProblem[] }) {
  if (codes.length === 0) return null;
  return (
    <ul role="alert" className="list-disc space-y-1 ps-5 text-sm font-semibold text-danger-strong">
      {codes.map((code) => (
        <li key={code}>{m.errors[code]}</li>
      ))}
    </ul>
  );
}

/**
 * The question dialog: a new question (POST) or an edit (PUT with the question's `updatedAt`, refused as `stale`
 * if it changed since). In a published exam the save makes version n+1 and says so. Options are lettered by their
 * place; the admin marks the correct one.
 */
function QuestionDialog({
  m,
  examId,
  question,
  editMakesVersion,
  onClose,
}: {
  m: M;
  examId: string;
  question?: EditableQuestion;
  editMakesVersion: boolean;
  onClose: () => void;
}) {
  const d = m.questions.dialog;
  const router = useRouter();
  const [values, setValues] = useState<QuestionFormValues>(() => toQuestionValues(question));
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [refused, setRefused] = useState<AuthoringProblem[]>([]);
  const problems = checked ? questionProblems(values) : { options: [] };
  const nextVersion = question ? String(question.version + 1) : '';
  const formId = `question-form-${question?.id ?? 'new'}`;

  function close() {
    if (!pending) onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setChecked(true);
    setRefused([]);
    if (hasQuestionProblems(questionProblems(values))) return;
    setPending(true);
    try {
      const body = questionBody(values);
      await api(
        question
          ? `${questionsPath(examId)}/${encodeURIComponent(question.id)}`
          : questionsPath(examId),
        {
          method: question ? 'PUT' : 'POST',
          body: JSON.stringify(
            question ? { ...body, expectedUpdatedAt: question.updatedAt } : body,
          ),
        },
      );
      onClose();
      router.refresh();
    } catch (failure) {
      setRefused(authoringProblems(failure));
      setPending(false);
    }
  }

  const problem = (p: keyof typeof m.questions.problems | undefined) =>
    p ? m.questions.problems[p] : undefined;
  return (
    <Dialog
      open
      onClose={close}
      title={question ? d.editTitle : d.addTitle}
      closeLabel={d.cancel}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" disabled={pending} onClick={close}>
            {d.cancel}
          </Button>
          <Button type="submit" form={formId} loading={pending} loadingLabel={d.busy}>
            {question && editMakesVersion ? d.saveVersion(nextVersion) : d.save}
          </Button>
        </div>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="space-y-5">
        {question && editMakesVersion ? (
          <p
            role="note"
            className="rounded-control bg-warning-soft p-3 text-sm text-warning-strong"
          >
            {d.versionNote(nextVersion)}
          </p>
        ) : null}
        <TextAreaField
          id={`${formId}-text`}
          label={d.text}
          rows={3}
          value={values.text}
          maxLength={EXAM_LIMITS.questionTextMax}
          disabled={pending}
          error={problem(problems.text)}
          onChange={(e) => setValues((v) => ({ ...v, text: e.target.value }))}
        />

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">{d.options}</legend>
          <p className="text-xs text-ink-faint">{d.optionsHint}</p>
          {values.options.map((text, i) => {
            const key = optionKey(i);
            const optionId = `${formId}-option-${key}`;
            const error = problem(problems.options[i]);
            return (
              <div key={key} className="space-y-1">
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-control border bg-page px-3 py-2 focus-within:border-primary',
                    error
                      ? 'border-danger'
                      : values.correct === i
                        ? 'border-success'
                        : 'border-line',
                  )}
                >
                  <input
                    type="radio"
                    name={`${formId}-correct`}
                    checked={values.correct === i}
                    disabled={pending}
                    aria-label={d.correctLabel(key)}
                    onChange={() => setValues((v) => ({ ...v, correct: i }))}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <label
                    htmlFor={optionId}
                    className="w-6 shrink-0 text-sm font-bold text-ink-muted"
                  >
                    {key}
                  </label>
                  <input
                    id={optionId}
                    value={text}
                    maxLength={EXAM_LIMITS.optionTextMax}
                    disabled={pending}
                    aria-label={d.option(key)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${optionId}-error` : undefined}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        options: v.options.map((o, j) => (j === i ? e.target.value : o)),
                      }))
                    }
                    className="min-w-0 flex-1 bg-transparent text-ink outline-none"
                  />
                  <button
                    type="button"
                    disabled={pending || values.options.length <= EXAM_LIMITS.optionsMin}
                    aria-label={d.removeOption(key)}
                    onClick={() => setValues((v) => removeOption(v, i))}
                    className="rounded-control p-1 text-ink-faint hover:bg-surface hover:text-danger-strong disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
                {error ? (
                  <p id={`${optionId}-error`} className="text-xs font-medium text-danger-strong">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
          {problems.correct ? (
            <p className="text-xs font-medium text-danger-strong">{problem(problems.correct)}</p>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending || values.options.length >= EXAM_LIMITS.optionsMax}
            onClick={() => setValues((v) => addOption(v))}
          >
            <span className="inline-flex items-center gap-2">
              <Plus size={16} aria-hidden="true" />
              {d.addOption}
            </span>
          </Button>
        </fieldset>

        <TextAreaField
          id={`${formId}-explanation`}
          label={d.explanation}
          rows={3}
          value={values.explanation}
          maxLength={EXAM_LIMITS.explanationMax}
          disabled={pending}
          hint={d.explanationHint}
          error={problem(problems.explanation)}
          onChange={(e) => setValues((v) => ({ ...v, explanation: e.target.value }))}
        />

        <div className="space-y-1">
          <label className="flex items-start gap-3 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={values.keepOptionOrder}
              disabled={pending}
              aria-describedby={`${formId}-keep-hint`}
              onChange={(e) => setValues((v) => ({ ...v, keepOptionOrder: e.target.checked }))}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            {d.keepOrder}
          </label>
          <p id={`${formId}-keep-hint`} className="ps-7 text-xs text-ink-faint">
            {d.keepOrderHint}
          </p>
        </div>

        <Refusals m={m} codes={refused} />
      </form>
    </Dialog>
  );
}

/** "Add question" above the list (a draft, or a published exam with a random draw). */
export function AddQuestionButton({ locale, examId }: { locale: Locale; examId: string }) {
  const m = pick(adminExamAuthoringMessages, locale);
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button disabled={!hydrated} onClick={() => setOpen(true)}>
        <span className="inline-flex items-center gap-2">
          <Plus size={16} aria-hidden="true" />
          {m.questions.add}
        </span>
      </Button>
      {open ? (
        <QuestionDialog
          m={m}
          examId={examId}
          editMakesVersion={false}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Edit, and delete (a draft) or retire (a published exam with a random draw), for one question. Retiring is offered
 * only while more than the questions per attempt stay active; the server checks again. `children` join the same row
 * (the answer-key correction, E7b).
 */
export function QuestionActions({
  locale,
  examId,
  question,
  number,
  rules,
  children,
}: {
  locale: Locale;
  examId: string;
  question: EditableQuestion;
  /** The question's number in the list, already formatted. */
  number: string;
  rules: QuestionRules;
  children?: ReactNode;
}) {
  const m = pick(adminExamAuthoringMessages, locale);
  const q = m.questions;
  const router = useRouter();
  const hydrated = useHydrated();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<AuthoringProblem[]>([]);

  async function remove() {
    setConfirming(false);
    setBusy(true);
    setRefused([]);
    try {
      await api(`${questionsPath(examId)}/${encodeURIComponent(question.id)}`, {
        method: 'DELETE',
      });
      router.refresh();
    } catch (failure) {
      setRefused(authoringProblems(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!rules.canEdit && !rules.removal && !children) return null;
  const retire = rules.removal === 'retire';
  const confirm = retire ? q.confirmRetire : q.confirmDelete;
  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {rules.canEdit ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!hydrated || busy}
            aria-label={q.editLabel(number)}
            onClick={() => setEditing(true)}
          >
            <span className="inline-flex items-center gap-2">
              <Pencil size={14} aria-hidden="true" />
              {q.edit}
            </span>
          </Button>
        ) : null}
        {rules.removal ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={!hydrated || busy || !rules.canRemoveNow}
            loading={busy}
            loadingLabel={m.state.busy}
            aria-label={retire ? q.retireLabel(number) : q.deleteLabel(number)}
            onClick={() => setConfirming(true)}
          >
            <span className="inline-flex items-center gap-2">
              <Trash2 size={14} aria-hidden="true" />
              {retire ? q.retire : q.delete}
            </span>
          </Button>
        ) : null}
        {children}
        {retire && !rules.canRemoveNow ? (
          <span className="text-xs text-ink-faint">{q.retireBlocked}</span>
        ) : null}
      </div>
      <Refusals m={m} codes={refused} />
      {editing ? (
        <QuestionDialog
          m={m}
          examId={examId}
          question={question}
          editMakesVersion={rules.editMakesVersion}
          onClose={() => setEditing(false)}
        />
      ) : null}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={confirm.title}
        closeLabel={m.state.cancel}
        footer={
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {m.state.cancel}
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              {confirm.button}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink">{confirm.body}</p>
      </Dialog>
    </div>
  );
}
