import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, CalendarDays, CalendarX2, Clock, ListChecks } from 'lucide-react';
import type { StudentExamListItem, StudentExamState } from '@sirat/shared';
import { Badge, buttonClasses, cn, EmptyState, PageHeader } from '@sirat/ui';
import { examStateTone } from '@/components/status';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { studentExamsMessages } from '@/i18n/messages/student-exams';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

/*
 * "My Exams" (old dashboard/quizzes/page.jsx): one card per exam with a coloured top strip.
 * The server decides each exam's state from its clock; this page only shows it, and links to the
 * exam room (/dashboard/exam/<id>), where the server decides again. The old browser-side search
 * and hard-coded exam dates are dropped (the list is short and server-made).
 */

type ExamsMessages = (typeof studentExamsMessages)['en'];
type StateTone = (typeof examStateTone)[StudentExamState];

/**
 * 6px strip at the top of each card, in the colour of the card's state badge. It is keyed by the
 * shared badge tone, not by state, so the strip and the badge can never disagree.
 */
const STRIP_BY_TONE: Record<StateTone, string> = {
  neutral: 'bg-ink-faint',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  brand: 'bg-primary',
  gold: 'bg-rank-gold',
  silver: 'bg-rank-silver',
  bronze: 'bg-rank-bronze',
};

/**
 * The line under the state badge, only where it adds something. It never repeats the badge word
 * or a date the card already shows (Starts/Ends), so upcoming and closed exams have none.
 */
function helperLine(state: StudentExamState, m: ExamsMessages): string | null {
  switch (state) {
    case 'open':
      return m.helper.open;
    case 'in_progress':
      return m.helper.inProgress;
    case 'submitted':
      return m.helper.submitted;
    case 'upcoming':
    case 'closed':
      return null;
  }
}

/** The card's link: the exam room, or the review once the results are published. A closed exam has none. */
function action(
  exam: StudentExamListItem,
  m: ExamsMessages,
): { label: string; href: string; primary: boolean } | null {
  const room = `/dashboard/exam/${encodeURIComponent(exam.id)}`;
  if (exam.state === 'submitted' && exam.resultsPublished)
    return { label: m.action.results, href: `${room}/review`, primary: true };
  const label = actionLabel(exam.state, m);
  return label
    ? { label, href: room, primary: exam.state === 'open' || exam.state === 'in_progress' }
    : null;
}

function actionLabel(state: StudentExamState, m: ExamsMessages): string | null {
  switch (state) {
    case 'upcoming':
      return m.action.upcoming;
    case 'open':
      return m.action.open;
    case 'in_progress':
      return m.action.inProgress;
    case 'submitted':
      return m.action.submitted;
    case 'closed':
      return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(studentExamsMessages);
  return { title: m.title };
}

export default async function MyExamsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/dashboard/exam');
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(studentExamsMessages),
    getMessages(common),
    getData(params),
  ]);
  const exams = await data.student.listExams();
  return (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} />
      {exams.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-7 w-7" />}
          title={m.empty.title}
          description={m.empty.description}
        />
      ) : (
        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {exams.map((exam) => {
            const tone = examStateTone[exam.state];
            const helper = helperLine(exam.state, m);
            const link = action(exam, m);
            return (
              <li
                key={exam.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
              >
                <div aria-hidden="true" className={cn('h-1.5', STRIP_BY_TONE[tone])} />
                <div className="flex flex-1 flex-col p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate rounded-full border border-secondary/15 bg-secondary-soft px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-secondary">
                      {exam.category ? c.categories[exam.category] : m.allCategories}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-ink-muted">
                      <Clock aria-hidden className="h-3.5 w-3.5" />
                      {m.minutes(formatNumber(locale, exam.durationMinutes))}
                    </span>
                  </div>
                  <h2 className="mb-3 line-clamp-2 break-words text-base font-bold leading-snug text-ink">
                    {exam.title}
                  </h2>
                  {/* A div inside a dl may hold only dt and dd, so each icon sits inside its dt. */}
                  <dl className="mb-4 space-y-1.5 text-xs text-ink-muted">
                    <div className="flex items-center gap-1.5">
                      <dt className="flex items-center gap-1.5">
                        <CalendarDays aria-hidden className="h-3.5 w-3.5 shrink-0" />
                        {m.starts}
                      </dt>
                      <dd className="font-semibold text-ink">
                        <time dateTime={exam.windowStart}>
                          {formatDateTime(locale, exam.windowStart)}
                        </time>
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="flex items-center gap-1.5">
                        <CalendarX2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
                        {m.ends}
                      </dt>
                      <dd className="font-semibold text-ink">
                        <time dateTime={exam.windowEnd}>
                          {formatDateTime(locale, exam.windowEnd)}
                        </time>
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="flex items-center gap-1.5">
                        <ListChecks aria-hidden className="h-3.5 w-3.5 shrink-0" />
                        {m.questions}
                      </dt>
                      <dd className="font-semibold text-ink">
                        {formatNumber(locale, exam.questionsPerAttempt)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-auto flex flex-col items-start gap-2 border-t border-line pt-3">
                    <Badge tone={tone}>{c.examState[exam.state]}</Badge>
                    {helper ? <p className="text-xs text-ink-muted">{helper}</p> : null}
                    {link ? (
                      <Link
                        href={link.href}
                        className={buttonClasses({
                          variant: link.primary ? 'primary' : 'outline',
                          size: 'sm',
                          className: 'mt-1',
                        })}
                      >
                        {link.label}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
