'use client';
import { useState } from 'react';
import { Star } from 'lucide-react';
import {
  JURY_LIMITS,
  JURY_REFUSALS,
  ROUND_LIMITS,
  type JuryScoreResult,
  type RoundCriterion,
} from '@sirat/shared';
import { Button, Dialog, Field, TextAreaField } from '@sirat/ui';
import { useCall } from '@/components/admin/rounds/use-call';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { juryMessages } from '@/i18n/messages/jury';
import { scoreTotal } from './score-total';

/**
 * A judge scores one entry (core C6b): every criterion 0–10, a note for the jury, POST /api/jury/entries/:id/scores.
 * The total shown while typing is for display; the server computes the one that counts.
 */
export function ScoreButton({
  locale,
  entryId,
  code,
  criteria,
  previous,
}: {
  locale: Locale;
  entryId: string;
  code: string;
  criteria: RoundCriterion[];
  previous: Record<string, number> | null;
}) {
  const m = pick(juryMessages, locale);
  const n = (value: number) => formatNumber(locale, value);
  const { pending, problem, setProblem, run } = useCall(JURY_REFUSALS);
  const start = () =>
    Object.fromEntries(criteria.map((c) => [c.key, previous?.[c.key]?.toString() ?? '']));
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(start);
  const [comment, setComment] = useState('');
  const [saved, setSaved] = useState<JuryScoreResult | null>(null);
  const total = scoreTotal(values, criteria.length);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(null);
    if (total === null) return setProblem('bad_scores');
    const body = {
      criteria: Object.fromEntries(criteria.map((c) => [c.key, Number(values[c.key])])),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };
    const answer = await run<JuryScoreResult>(
      `/jury/entries/${encodeURIComponent(entryId)}/scores`,
      'POST',
      body,
    );
    if (answer && answer !== true) setSaved(answer);
  }

  return (
    <>
      <Button
        type="button"
        variant={previous ? 'outline' : 'primary'}
        size="sm"
        onClick={() => {
          setProblem(null);
          setSaved(null);
          setValues(start());
          setComment('');
          setOpen(true);
        }}
      >
        <Star aria-hidden="true" size={16} />
        {previous ? m.score.again : m.score.button}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={m.score.title(code)}
        closeLabel={m.cancel}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{m.score.text}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {criteria.map((c) => (
              <Field
                key={c.key}
                id={`score-${entryId}-${c.key}`}
                name={c.key}
                type="number"
                inputMode="numeric"
                min={0}
                max={ROUND_LIMITS.criterionMax}
                step={1}
                label={locale === 'bn' ? c.bn : c.en}
                value={values[c.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [c.key]: e.target.value }))}
              />
            ))}
          </div>
          <p className="text-sm font-semibold text-ink" aria-live="polite">
            {m.score.total(total === null ? '–' : n(total))}
          </p>
          <TextAreaField
            id={`score-comment-${entryId}`}
            name="comment"
            label={m.score.comment}
            rows={3}
            maxLength={JURY_LIMITS.commentMax}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem as keyof typeof m.errors] ?? m.errors.failed}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="text-sm font-semibold text-success-strong">
              {m.score.saved(n(saved.total), n(saved.score), n(saved.judges))}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? m.pending : m.score.submit}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
