'use client';
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import {
  CATEGORIES,
  ROUND_LIMITS as L,
  type Category,
  type PromotionPreview,
  type PromotionResult,
} from '@sirat/shared';
import { Button, Dialog, Field, SelectField } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { common } from '@/i18n/common';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { adminRoundsMessages } from '@/i18n/messages/admin-rounds';
import { typedCountMatches } from './round-form';
import { useRoundAction } from './use-round-action';

/**
 * Promote one category from a round to the next (core C6a; lead's review): a preview with the counts and the tie
 * count first, then the admin types the number that will go through, then one POST with the preview's `expected`.
 */
export function PromoteButton({
  locale,
  round,
  nextName,
}: {
  locale: Locale;
  round: { id: string; name: string };
  nextName: string;
}) {
  const m = pick(adminRoundsMessages, locale);
  const c = pick(common, locale);
  const n = (value: number) => formatNumber(locale, value);
  const { pending, problem, setProblem, run } = useRoundAction();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>('activist');
  const [topN, setTopN] = useState('100');
  const [preview, setPreview] = useState<PromotionPreview | null>(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<PromotionResult | null>(null);
  const base = `/admin/rounds/${encodeURIComponent(round.id)}/promotion`;

  function changed() {
    setPreview(null);
    setTyped('');
    setResult(null);
    setProblem(null);
  }

  function query() {
    const value = Number(topN);
    return Number.isInteger(value) && value >= 1 && value <= L.topNMax
      ? { topN: value, category }
      : null;
  }

  async function look() {
    const q = query();
    if (!q) return setProblem('invalid');
    setResult(null);
    const answer = await run<PromotionPreview>(`${base}/preview`, 'POST', q, false);
    setPreview(answer);
    setTyped('');
  }

  async function promote() {
    const q = query();
    if (!q || !preview || !typedCountMatches(typed, preview.promoted)) return;
    const answer = await run<PromotionResult>(base, 'POST', { ...q, expected: preview.expected });
    if (answer) {
      setResult(answer);
      setPreview(null);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          changed();
          setOpen(true);
        }}
      >
        <ArrowUpRight aria-hidden="true" size={16} />
        {m.promote.button}
      </Button>
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={m.promote.title(round.name, nextName)}
        closeLabel={m.cancel}
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id={`promote-category-${round.id}`}
              name="category"
              label={m.promote.category}
              value={category}
              options={CATEGORIES.map((value) => ({ value, label: c.categories[value] }))}
              onChange={(e) => {
                setCategory(e.target.value as Category);
                changed();
              }}
            />
            <Field
              id={`promote-top-${round.id}`}
              name="topN"
              type="number"
              inputMode="numeric"
              min={1}
              max={L.topNMax}
              label={m.promote.topN}
              value={topN}
              onChange={(e) => {
                setTopN(e.target.value);
                changed();
              }}
            />
          </div>
          <p className="text-xs text-ink-muted">{m.promote.topNHint}</p>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={look} disabled={pending}>
              {pending && !preview ? m.pending : m.promote.preview}
            </Button>
          </div>

          {preview ? (
            <div className="flex flex-col gap-3 rounded-control border border-line bg-page p-4 text-sm">
              <p className="text-ink-muted">
                {preview.source.kind === 'exam'
                  ? m.promote.sourceExam(preview.source.examTitle, n(preview.source.generation))
                  : m.promote.sourceJury}
              </p>
              <dl className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <dt className="text-xs text-ink-muted">{m.promote.candidates}</dt>
                  <dd className="text-lg font-black tabular-nums text-ink">
                    {n(preview.candidates)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">{m.promote.promoted}</dt>
                  <dd className="text-lg font-black tabular-nums text-success-strong">
                    {n(preview.promoted)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">{m.promote.eliminated}</dt>
                  <dd className="text-lg font-black tabular-nums text-ink">
                    {n(preview.eliminated)}
                  </dd>
                </div>
              </dl>
              {preview.tieCount > 0 ? (
                <p className="font-semibold text-warning-strong">
                  {m.promote.ties(n(preview.tieCount))}
                </p>
              ) : null}
              {preview.cut ? (
                <p className="text-ink">
                  {m.promote.cut(n(preview.cut.rank), n(preview.cut.score))}
                  {preview.cut.timeTakenSeconds === null
                    ? null
                    : m.promote.cutTime(n(preview.cut.timeTakenSeconds))}
                </p>
              ) : null}
              <p className="text-xs text-ink-muted">{m.promote.final}</p>
              <Field
                id={`promote-confirm-${round.id}`}
                name="confirm"
                inputMode="numeric"
                autoComplete="off"
                label={m.promote.confirmLabel(n(preview.promoted))}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={promote}
                  disabled={
                    pending || preview.promoted === 0 || !typedCountMatches(typed, preview.promoted)
                  }
                >
                  {pending ? m.pending : m.promote.confirm}
                </Button>
              </div>
            </div>
          ) : null}

          {result ? (
            <p role="status" className="text-sm font-semibold text-success-strong">
              {m.promote.done(n(result.promoted), result.toRound.name)}
            </p>
          ) : null}
          {problem ? (
            <p role="alert" className="text-sm font-medium text-danger-strong">
              {m.errors[problem]}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
