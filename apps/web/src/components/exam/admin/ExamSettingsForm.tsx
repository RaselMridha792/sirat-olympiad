'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CATEGORIES, EXAM_LIMITS, EXAM_MAX_DURATION_MINUTES, type Category } from '@sirat/shared';
import { Button, buttonClasses, Card, Field, SelectField } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { adminExamAuthoringMessages } from '@/i18n/messages/admin-exam-authoring';
import { api } from '@/lib/api';
import {
  authoringProblems,
  createExamBody,
  editableFields,
  examFormProblems,
  isoToDhaka,
  patchExamBody,
  toExamValues,
  type AuthoringProblem,
  type ExamField,
  type ExamFormProblems,
  type ExamFormValues,
  type ExamSettings,
} from './exam-authoring';

const examPath = (id: string) => `/admin/exams/${encodeURIComponent(id)}`;

/**
 * The exam settings form: a new draft (POST /api/admin/exams), or an exam's settings (PATCH with the version the
 * page loaded, so a change made elsewhere since is refused as `stale`, never overwritten). A published exam takes
 * only its title and a later closing time with a reason; the frozen fields stay visible, read-only, with why.
 * Times are entered and shown in Bangladesh time. Rounds have no API yet, so none is offered.
 */
export function ExamSettingsForm({
  locale,
  categoryLabels,
  exam,
}: {
  locale: Locale;
  categoryLabels: Record<Category, string>;
  /** Absent: a new exam. */
  exam?: ExamSettings;
}) {
  const m = pick(adminExamAuthoringMessages, locale);
  const f = m.form;
  const router = useRouter();
  const hydrated = useHydrated();
  const [values, setValues] = useState<ExamFormValues>(() => toExamValues(exam));
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [refused, setRefused] = useState<AuthoringProblem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const editable = editableFields(exam?.status ?? 'new');
  const problems: ExamFormProblems = checked ? examFormProblems(values, exam) : {};
  const extending = exam?.status === 'published' && values.windowEnd !== isoToDhaka(exam.windowEnd);
  const set = <K extends keyof ExamFormValues>(key: K, value: ExamFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setNotice(null);
  };
  const error = (field: ExamField | 'reason') => {
    const problem = problems[field];
    return problem ? f.problems[problem] : undefined;
  };
  const hint = (field: ExamField, own?: string) =>
    exam && !editable.has(field) && exam.status === 'published' ? f.frozen : own;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setChecked(true);
    setRefused([]);
    setNotice(null);
    if (Object.keys(examFormProblems(values, exam)).length > 0) return;
    const body = exam ? patchExamBody(exam, values) : createExamBody(values);
    if (!body) {
      setNotice(f.nothingChanged);
      return;
    }
    setPending(true);
    try {
      const saved = await api<{ id?: unknown }>(exam ? examPath(exam.id) : '/admin/exams', {
        method: exam ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      const id = exam?.id ?? (typeof saved?.id === 'string' ? saved.id : null);
      if (id) router.push(examPath(id));
      else router.push('/admin/exams');
      router.refresh();
    } catch (failure) {
      setRefused(authoringProblems(failure));
      setPending(false);
    }
  }

  const archived = exam?.status === 'archived';
  const disabled = (field: ExamField) => pending || !editable.has(field);
  const hasProblems = Object.keys(problems).length > 0;
  return (
    <Card>
      <form noValidate onSubmit={(e) => void submit(e)} className="space-y-6">
        {archived ? (
          <p role="status" className="text-sm font-semibold text-ink-muted">
            {f.archived}
          </p>
        ) : null}

        <Field
          id="exam-title"
          label={f.title}
          value={values.title}
          maxLength={EXAM_LIMITS.titleMax}
          disabled={disabled('title')}
          error={error('title')}
          hint={hint('title')}
          onChange={(e) => set('title', e.target.value)}
        />

        <SelectField
          id="exam-category"
          label={f.category}
          value={values.category}
          disabled={disabled('category')}
          hint={hint('category')}
          options={[
            { value: '', label: f.allCategories },
            ...CATEGORIES.map((c) => ({ value: c, label: categoryLabels[c] })),
          ]}
          onChange={(e) => set('category', e.target.value as ExamFormValues['category'])}
        />

        <div className="grid gap-6 md:grid-cols-2">
          <Field
            id="exam-window-start"
            type="datetime-local"
            step={60}
            label={f.windowStart}
            value={values.windowStart}
            disabled={disabled('windowStart')}
            error={error('windowStart')}
            hint={hint('windowStart', f.timeHint)}
            onChange={(e) => set('windowStart', e.target.value)}
          />
          <Field
            id="exam-window-end"
            type="datetime-local"
            step={60}
            label={f.windowEnd}
            value={values.windowEnd}
            disabled={disabled('windowEnd')}
            error={error('windowEnd')}
            hint={f.timeHint}
            onChange={(e) => set('windowEnd', e.target.value)}
          />
        </div>

        {extending ? (
          <Field
            id="exam-reason"
            label={f.reason}
            value={values.reason}
            maxLength={EXAM_LIMITS.reasonMax}
            disabled={pending}
            error={error('reason')}
            hint={f.reasonHint}
            onChange={(e) => set('reason', e.target.value)}
          />
        ) : null}

        <div className="grid gap-6 md:grid-cols-3">
          <Field
            id="exam-duration"
            type="number"
            inputMode="numeric"
            min={1}
            max={EXAM_MAX_DURATION_MINUTES}
            label={f.duration}
            value={values.durationMinutes}
            disabled={disabled('durationMinutes')}
            error={error('durationMinutes')}
            hint={hint('durationMinutes', f.durationHint)}
            onChange={(e) => set('durationMinutes', e.target.value)}
          />
          <Field
            id="exam-questions"
            type="number"
            inputMode="numeric"
            min={1}
            max={EXAM_LIMITS.questionsPerAttemptMax}
            label={f.questionsPerAttempt}
            value={values.questionsPerAttempt}
            disabled={disabled('questionsPerAttempt')}
            error={error('questionsPerAttempt')}
            hint={hint('questionsPerAttempt', f.questionsHint)}
            onChange={(e) => set('questionsPerAttempt', e.target.value)}
          />
          <Field
            id="exam-grace"
            type="number"
            inputMode="numeric"
            min={0}
            max={EXAM_LIMITS.graceSecondsMax}
            label={f.grace}
            value={values.graceSeconds}
            disabled={disabled('graceSeconds')}
            error={error('graceSeconds')}
            hint={hint('graceSeconds', f.graceHint)}
            onChange={(e) => set('graceSeconds', e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="flex items-start gap-3 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={values.randomDraw}
              disabled={disabled('randomDraw')}
              aria-describedby="exam-random-draw-hint"
              onChange={(e) => set('randomDraw', e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            {f.randomDraw}
          </label>
          <p id="exam-random-draw-hint" className="ps-7 text-xs text-ink-faint">
            {hint('randomDraw', f.randomDrawHint)}
          </p>
        </div>

        <p className="text-xs text-ink-faint">{f.noRound}</p>

        {hasProblems ? (
          <p role="alert" className="text-sm font-semibold text-danger-strong">
            {f.fix}
          </p>
        ) : null}
        {refused.length > 0 ? (
          <ul
            role="alert"
            className="list-disc space-y-1 ps-5 text-sm font-semibold text-danger-strong"
          >
            {refused.map((code) => (
              <li key={code}>{m.errors[code]}</li>
            ))}
          </ul>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-ink-muted">
            {notice}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={!hydrated || pending || archived}
            loading={pending}
            loadingLabel={f.busy}
          >
            {exam ? f.save : f.create}
          </Button>
          <Link
            href={exam ? examPath(exam.id) : '/admin/exams'}
            className={buttonClasses({ variant: 'ghost' })}
          >
            {f.cancel}
          </Link>
        </div>
      </form>
    </Card>
  );
}
