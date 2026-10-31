import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CheckCircle,
  Clock,
  Hourglass,
  Layers,
  ListChecks,
  Lock,
} from 'lucide-react';
import { EXAM_VIOLATION_WARNINGS } from '@sirat/shared';
import { Badge, Card, cn, EmptyState, PageHeader } from '@sirat/ui';
import {
  ATTEMPT_FILTERS,
  ExamAttemptsSection,
  ExamResultsSection,
  MIN_VIOLATIONS_FILTER,
} from '@/components/exam/admin/ExamResultsPanel';
import { examStatusTone } from '@/components/status';
import { getData } from '@/data';
import { parseEnum, parseId, parsePageQuery, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { adminExamResultsMessages } from '@/i18n/messages/admin-exam-results';
import { adminExamsMessages } from '@/i18n/messages/admin-exams';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const ATTEMPTS_PAGE_SIZE = 20;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminExamsMessages);
  return { title: m.detail.metaTitle };
}

/**
 * Admin exam detail (old quiz-management/view/[id]) with the answer keys. Staff only: no student
 * shape carries `correctKey`. Once published, the results panel and the attempts with their
 * violations (owner Q4) come first. Editing arrives with E5b.
 */
export default async function AdminExamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/admin/exams/[id]');
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const examId = parseId(id);
  if (!examId) notFound();
  const [{ locale, m }, { m: c }, { m: r }, data] = await Promise.all([
    getMessages(adminExamsMessages),
    getMessages(common),
    getMessages(adminExamResultsMessages),
    getData(query),
  ]);
  const filter = parseEnum(query.filter, ATTEMPT_FILTERS);
  const page = parsePageQuery(query, ATTEMPTS_PAGE_SIZE);
  const attemptId = parseId(query.attempt);
  const [exam, results, attempts, attempt] = await Promise.all([
    data.admin.getExam(examId),
    data.admin.getExamResults(examId),
    data.admin.listAttempts(examId, {
      ...page,
      ...(filter === 'violations' ? { endReason: 'violations' as const } : {}),
      ...(filter === 'min3' ? { minViolations: MIN_VIOLATIONS_FILTER } : {}),
    }),
    attemptId ? data.admin.getAttempt(examId, attemptId) : Promise.resolve(null),
  ]);
  if (!exam) notFound();
  const path = `/admin/exams/${encodeURIComponent(exam.id)}`;

  const info: Array<{ key: string; label: string; value: string; icon: ReactNode; tone: string }> =
    [
      {
        key: 'duration',
        label: m.detail.info.duration,
        value: m.minutes(formatNumber(locale, exam.durationMinutes)),
        icon: <Clock size={20} />,
        tone: 'bg-info-soft text-info-strong',
      },
      {
        key: 'questions',
        label: m.detail.info.questions,
        value: m.questionsOf(
          formatNumber(locale, exam.questionsPerAttempt),
          formatNumber(locale, exam.questionCount),
        ),
        icon: <ListChecks size={20} />,
        tone: 'bg-primary-soft text-primary-strong',
      },
      {
        key: 'grace',
        label: m.detail.info.grace,
        value: m.seconds(formatNumber(locale, exam.graceSeconds)),
        icon: <Hourglass size={20} />,
        tone: 'bg-warning-soft text-warning-strong',
      },
      {
        key: 'round',
        label: m.detail.info.round,
        value: exam.round?.name ?? m.detail.noRound,
        icon: <Layers size={20} />,
        tone: 'bg-secondary-soft text-secondary',
      },
      {
        key: 'opens',
        label: m.detail.info.opens,
        value: formatDateTime(locale, exam.windowStart),
        icon: <CalendarClock size={20} />,
        tone: 'bg-secondary-soft text-secondary',
      },
      {
        key: 'closes',
        label: m.detail.info.closes,
        value: formatDateTime(locale, exam.windowEnd),
        icon: <CalendarX size={20} />,
        tone: 'bg-secondary-soft text-secondary',
      },
      {
        key: 'results',
        label: m.detail.info.results,
        value: exam.resultsPublishedAt
          ? formatDateTime(locale, exam.resultsPublishedAt)
          : m.detail.notYet,
        icon: <CalendarCheck size={20} />,
        tone: 'bg-success-soft text-success-strong',
      },
    ];

  return (
    <>
      <Link
        href="/admin/exams"
        className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-secondary underline-offset-4 hover:underline"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {m.detail.back}
      </Link>

      <PageHeader
        title={exam.title}
        subtitle={m.detail.adminNote}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={examStatusTone[exam.status]}>{c.examStatus[exam.status]}</Badge>
            <Badge tone="brand">
              {exam.category ? c.categories[exam.category] : m.allCategories}
            </Badge>
            {exam.locked ? (
              <Badge tone="neutral">
                <span className="inline-flex items-center gap-1">
                  <Lock size={12} aria-hidden="true" />
                  {m.locked}
                </span>
              </Badge>
            ) : null}
          </div>
        }
      />

      <dl className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {info.map((item) => (
          <div
            key={item.key}
            className="relative min-h-20 rounded-card border border-line bg-surface py-4 pl-20 pr-4 shadow-card"
          >
            <dt className="text-xs font-bold uppercase tracking-wider text-ink-faint">
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-control',
                  item.tone,
                )}
              >
                {item.icon}
              </span>
              {item.label}
            </dt>
            <dd className="mt-1 break-words text-base font-bold text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>

      {exam.status !== 'draft' && results ? (
        <>
          <ExamResultsSection exam={exam} results={results} locale={locale} m={r} />
          <ExamAttemptsSection
            path={path}
            list={attempts}
            filter={filter}
            q={page.q}
            attemptId={attemptId}
            detail={attempt}
            warnings={EXAM_VIOLATION_WARNINGS}
            locale={locale}
            m={r}
            c={c}
          />
        </>
      ) : null}

      <section aria-labelledby="exam-questions">
        <h2
          id="exam-questions"
          className="mb-4 border-l-4 border-secondary pl-3 text-xl font-black text-ink"
        >
          {m.detail.questionsHeading(formatNumber(locale, exam.questions.length))}
        </h2>

        {exam.questions.length === 0 ? (
          <EmptyState icon={<ListChecks size={26} />} title={m.detail.noQuestions} />
        ) : (
          <ol className="space-y-4">
            {exam.questions.map((question, index) => (
              <li key={question.id}>
                <Card>
                  <p className="mb-4 text-lg font-bold text-ink">
                    {/* Real spaces (not only margins), so copied and read-aloud text is not run together. */}
                    <span className="mr-2 text-secondary">
                      {m.detail.questionNo(formatNumber(locale, index + 1))}
                    </span>{' '}
                    {question.text}
                    {question.version > 1 ? (
                      <>
                        {' '}
                        <span className="ml-2 inline-flex rounded-full bg-secondary-soft px-2 py-0.5 align-middle text-xs font-bold text-secondary">
                          {m.detail.version(formatNumber(locale, question.version))}
                        </span>
                      </>
                    ) : null}
                  </p>

                  <ul className="grid gap-3 md:grid-cols-2">
                    {question.options.map((option) => {
                      const correct = option.key === question.correctKey;
                      return (
                        <li
                          key={option.key}
                          className={cn(
                            'flex items-center gap-3 rounded-control border p-3',
                            correct ? 'border-success bg-success-soft' : 'border-line bg-page',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold',
                              correct
                                ? 'border-success bg-surface text-ink'
                                : 'border-line bg-surface text-ink-muted',
                            )}
                          >
                            {option.key}
                          </span>
                          <span
                            className={cn(
                              'min-w-0 flex-1 break-words text-ink',
                              correct && 'font-bold',
                            )}
                          >
                            {option.text}
                          </span>
                          {correct ? (
                            <>
                              <CheckCircle
                                size={20}
                                aria-hidden="true"
                                className="shrink-0 text-success"
                              />
                              <span className="sr-only">{m.detail.correct}</span>
                            </>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>

                  {question.explanation ? (
                    <p className="mt-4 text-sm text-ink-muted">
                      <span className="font-semibold text-ink">{m.detail.explanation}</span>{' '}
                      {question.explanation}
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
