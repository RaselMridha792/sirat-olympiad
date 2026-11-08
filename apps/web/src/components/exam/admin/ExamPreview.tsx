'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Clock, Eye, EyeOff, ListChecks, RefreshCw } from 'lucide-react';
import type { AdminExamPreview } from '@sirat/shared';
import { Button, Card } from '@sirat/ui';
import { useHydrated } from '@/components/auth/useHydrated';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { adminExamPreviewMessages } from '@/i18n/messages/admin-exam-preview';
import { examPlayerMessages } from '@/i18n/messages/exam-player';
import { QuestionCard, QuestionNumbers } from '../QuestionCard';

/**
 * The admin preview of one sample draw (D2): the student's question card and number list, with no controller, no
 * timer, no checkpoint and no submit. A pick only highlights the option here. "Show answers" marks the correct one
 * (off by default); "Draw again" asks the server for a new draw. The page keys this component by the draw, so a new
 * draw starts from the first question.
 */
export function ExamPreview({ locale, preview }: { locale: Locale; preview: AdminExamPreview }) {
  const m = pick(adminExamPreviewMessages, locale);
  const letters = pick(examPlayerMessages, locale).letters;
  const router = useRouter();
  const hydrated = useHydrated();
  const n = (v: number) => formatNumber(locale, v);
  const total = preview.questions.length;
  const [index, setIndex] = useState(0);
  const [picks, setPicks] = useState<Array<number | null>>(() => preview.questions.map(() => null));
  const [showAnswers, setShowAnswers] = useState(false);
  const question = preview.questions[index];
  const correct = preview.correct[index];

  return (
    <div className="space-y-5">
      <Card className="space-y-2 border-warning bg-warning-soft">
        <p role="note" className="text-sm font-semibold text-warning-strong">
          {m.banner}
        </p>
        {total < preview.questionsPerAttempt ? (
          <p className="text-sm text-warning-strong">
            {total === 0 ? m.empty : m.partial(n(total), n(preview.questionsPerAttempt))}
          </p>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
          <Clock aria-hidden className="h-4 w-4" />
          {m.duration(n(preview.durationMinutes))}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!hydrated || total === 0}
            aria-pressed={showAnswers}
            onClick={() => setShowAnswers((v) => !v)}
          >
            <span className="inline-flex items-center gap-2">
              {showAnswers ? (
                <EyeOff aria-hidden className="h-4 w-4" />
              ) : (
                <Eye aria-hidden className="h-4 w-4" />
              )}
              {showAnswers ? m.hideAnswers : m.showAnswers}
            </span>
          </Button>
          <Button variant="ghost" size="sm" disabled={!hydrated} onClick={() => router.refresh()}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw aria-hidden className="h-4 w-4" />
              {m.drawAgain}
            </span>
          </Button>
        </div>
      </div>

      {question ? (
        <>
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <p className="border-b border-line bg-page/60 px-4 py-3 text-sm font-semibold text-ink-muted md:px-10">
              {m.questionOf(n(index + 1), n(total))}
            </p>
            <section className="px-4 py-6 md:px-10 md:py-10">
              <QuestionCard
                text={question.text}
                options={question.options}
                selected={picks[index] ?? null}
                letters={letters}
                onSelect={(position) =>
                  setPicks((all) => all.map((p, i) => (i === index ? position : p)))
                }
              />
              {showAnswers && correct !== undefined ? (
                <p className="mt-5 rounded-control bg-success-soft p-3 text-sm font-semibold text-success-strong">
                  {m.correct(letters[correct] ?? n(correct + 1), question.options[correct] ?? '')}
                </p>
              ) : null}
            </section>
            <footer className="flex items-center justify-between gap-2 border-t border-line bg-page/60 px-4 py-3 md:px-10 md:py-6">
              <Button
                variant="outline"
                disabled={index === 0}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft aria-hidden className="h-4 w-4" />
                {m.previous}
              </Button>
              <Button
                disabled={index === total - 1}
                onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
              >
                {m.next}
                <ChevronRight aria-hidden className="h-4 w-4" />
              </Button>
            </footer>
          </div>

          <nav
            aria-label={m.list}
            className="rounded-card border border-line bg-surface p-4 shadow-card md:p-6"
          >
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
              <ListChecks aria-hidden className="h-4 w-4" />
              {m.list}
            </h2>
            <QuestionNumbers
              count={total}
              index={index}
              answered={(i) => picks[i] !== null && picks[i] !== undefined}
              onPick={setIndex}
              format={n}
            />
          </nav>
        </>
      ) : null}
    </div>
  );
}
