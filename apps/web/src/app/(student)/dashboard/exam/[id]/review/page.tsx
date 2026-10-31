import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Clock, Hash, Lightbulb, Target, XCircle } from 'lucide-react';
import type { ReviewView } from '@sirat/shared';
import { Badge, buttonClasses, Card, cn, EmptyState, PageHeader, StatCard } from '@sirat/ui';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import { formatDuration, formatNumber } from '@/i18n/format';
import type { Locale } from '@/i18n';
import type { Messages } from '@/i18n/messages';
import { examPlayerMessages } from '@/i18n/messages/exam-player';
import { examReviewMessages } from '@/i18n/messages/exam-review';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

/*
 * The student's review (owner Q5; EXAM-PLAN 3.11): own score, rank and time, then each question in the order the
 * student saw it, with their answer, the correct option and the explanation. The API answers only for the student's
 * own attempt and only after an admin has published the results; before that this page says so and asks for nothing.
 */

type M = Messages<typeof examReviewMessages>;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(examReviewMessages);
  return { title: m.title };
}

export default async function ExamReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/dashboard/exam');
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [{ locale, m }, { m: player }, data] = await Promise.all([
    getMessages(examReviewMessages),
    getMessages(examPlayerMessages),
    getData(query),
  ]);
  const exam = await data.student.getExam(id);
  if (!exam) notFound();
  const attemptId = exam.attempt?.attemptId;
  const review =
    exam.resultsPublished && attemptId ? await data.student.getReview(attemptId) : null;

  const back = (
    <Link href="/dashboard/exam" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
      {m.back}
    </Link>
  );
  if (!review) {
    return (
      <>
        <PageHeader title={exam.title} />
        <EmptyState
          icon={<Clock size={28} />}
          title={attemptId ? m.notYet.title : m.title}
          description={attemptId ? m.notYet.text : m.noAttempt}
          action={back}
        />
      </>
    );
  }

  const n = (v: number) => formatNumber(locale, v);
  return (
    <>
      <PageHeader title={exam.title} subtitle={player.receipt.reason[review.endReason]} />
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatCard
          title={m.stats.score}
          value={m.stats.scoreValue(n(review.score), n(review.questionCount))}
          icon={<Target size={20} />}
          tone="brand"
        />
        <StatCard
          title={m.stats.rank}
          value={review.rank === null ? m.stats.noRank : m.stats.rankValue(n(review.rank))}
          icon={<Hash size={20} />}
          tone="success"
        />
        <StatCard
          title={m.stats.time}
          value={
            review.timeTakenSeconds === null
              ? m.stats.noTime
              : formatDuration(locale, review.timeTakenSeconds)
          }
          icon={<Clock size={20} />}
          tone="info"
        />
      </div>

      <ol className="space-y-5">
        {review.questions.map((question, index) => (
          <ReviewQuestion
            key={index}
            question={question}
            index={index}
            total={review.questions.length}
            letters={player.letters}
            locale={locale}
            m={m}
          />
        ))}
      </ol>

      <div className="mt-8 flex flex-wrap gap-3">
        {back}
        <Link
          href={`/dashboard/leaderboard?exam=${encodeURIComponent(exam.id)}`}
          className={buttonClasses({ size: 'sm' })}
        >
          {m.leaderboard}
        </Link>
      </div>
    </>
  );
}

function ReviewQuestion({
  question,
  index,
  total,
  letters,
  locale,
  m,
}: {
  question: ReviewView['questions'][number];
  index: number;
  total: number;
  letters: readonly string[];
  locale: Locale;
  m: M;
}) {
  const n = (v: number) => formatNumber(locale, v);
  return (
    <li>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
            {m.question(n(index + 1), n(total))}
          </p>
          {question.chosen === null ? <Badge tone="warning">{m.notAnswered}</Badge> : null}
        </div>
        <h2 className="break-words text-lg font-bold leading-snug text-ink">{question.text}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {question.options.map((option, position) => {
            const correct = position === question.correct;
            const chosen = position === question.chosen;
            return (
              <li
                key={position}
                className={cn(
                  'flex items-start gap-3 rounded-card border-2 p-3',
                  correct
                    ? 'border-success bg-success-soft'
                    : chosen
                      ? 'border-danger bg-danger-soft'
                      : 'border-line bg-page',
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-sm font-bold text-ink-muted">
                  {letters[position] ?? position + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium text-ink">{option}</span>
                  {correct || chosen ? (
                    <span className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-ink">
                      {chosen ? <span>{m.yourAnswer}</span> : null}
                      {correct ? <span>{m.correctAnswer}</span> : null}
                    </span>
                  ) : null}
                </span>
                {correct ? (
                  <CheckCircle2 aria-hidden className="h-5 w-5 shrink-0 text-success-strong" />
                ) : chosen ? (
                  <XCircle aria-hidden className="h-5 w-5 shrink-0 text-danger-strong" />
                ) : null}
              </li>
            );
          })}
        </ul>
        {question.explanation ? (
          <div className="flex gap-3 rounded-control border border-line bg-page p-4 text-sm text-ink">
            <Lightbulb aria-hidden className="h-5 w-5 shrink-0 text-warning-strong" />
            <p className="break-words">
              <span className="font-bold">{m.explanation}: </span>
              {question.explanation}
            </p>
          </div>
        ) : null}
      </Card>
    </li>
  );
}
