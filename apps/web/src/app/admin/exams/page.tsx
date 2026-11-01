import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye, FileText, Lock, Plus, Search } from 'lucide-react';
import { EXAM_STATUSES, type AdminExamCard } from '@sirat/shared';
import {
  Badge,
  buttonClasses,
  Card,
  EmptyState,
  LinkPagination,
  PageHeader,
  SearchBox,
  Tabs,
} from '@sirat/ui';
import { examStatusTone } from '@/components/status';
import { getData } from '@/data';
import { hrefWith, parseEnum, parsePageQuery, totalPages, type SearchParams } from '@/data/query';
import type { Locale } from '@/i18n';
import { common, type CommonMessages } from '@/i18n/common';
import { formatDate, formatDateTime, formatNumber } from '@/i18n/format';
import type { Messages } from '@/i18n/messages';
import { adminExamAuthoringMessages } from '@/i18n/messages/admin-exam-authoring';
import { adminExamsMessages } from '@/i18n/messages/admin-exams';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/exams';
const PAGE_SIZE = 12;

type M = Messages<typeof adminExamsMessages>;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminExamsMessages);
  return { title: m.title };
}

/**
 * Exam list (old admin/quiz-management). "New exam" opens the settings form (E5b); "View" opens the detail with the
 * answer keys, where the questions, publishing and the results are managed.
 */
export default async function AdminExamsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/admin/exams');
  const params = await searchParams;
  const [{ locale, m }, { m: c }, { m: a }, data] = await Promise.all([
    getMessages(adminExamsMessages),
    getMessages(common),
    getMessages(adminExamAuthoringMessages),
    getData(params),
  ]);
  const query = parsePageQuery(params, PAGE_SIZE);
  const status = parseEnum(params.status, EXAM_STATUSES);
  const list = await data.admin.listExams({ ...query, status });
  const pages = totalPages(list.total, list.pageSize);
  const filtered = Boolean(query.q || status);

  const tabs = [
    { key: 'all', label: m.statusTabs.all, href: hrefWith(PATH, { q: query.q }) },
    ...EXAM_STATUSES.map((key) => ({
      key,
      label: c.examStatus[key],
      href: hrefWith(PATH, { status: key, q: query.q }),
    })),
  ];

  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.count(formatNumber(locale, list.total), list.total)}
        actions={
          <Link href="/admin/exams/new" className={buttonClasses()}>
            <span className="inline-flex items-center gap-2">
              <Plus size={16} aria-hidden="true" />
              {a.newExam}
            </span>
          </Link>
        }
      />

      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <Tabs items={tabs} activeKey={status ?? 'all'} label={m.statusTabs.label} linkAs={Link} />
        <SearchBox
          id="admin-exams-search"
          defaultValue={query.q}
          label={m.search.label}
          placeholder={m.search.placeholder}
          submitLabel={c.search.submit}
          action={PATH}
          preserve={{ status }}
          icon={<Search size={16} />}
        />
      </div>

      {list.items.length === 0 ? (
        <EmptyState
          icon={<FileText size={26} />}
          title={m.empty.title}
          description={filtered ? m.empty.filtered : m.empty.none}
          action={
            filtered ? (
              <Link
                href={PATH}
                className="text-sm font-semibold text-secondary underline-offset-4 hover:underline"
              >
                {m.empty.clear}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {list.items.map((exam) => (
            <li key={exam.id} className="flex">
              <ExamCard exam={exam} locale={locale} m={m} c={c} />
            </li>
          ))}
        </ul>
      )}

      <LinkPagination
        page={list.page}
        totalPages={pages}
        linkAs={Link}
        hrefFor={(page) => hrefWith(PATH, { status, q: query.q, page })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(formatNumber(locale, list.page), formatNumber(locale, pages))}
      />
    </>
  );
}

/** Old QuizCard, as a real grid cell (the old card forced col-span-full on every breakpoint). */
function ExamCard({
  exam,
  locale,
  m,
  c,
}: {
  exam: AdminExamCard;
  locale: Locale;
  m: M;
  c: CommonMessages;
}) {
  const info = [
    { label: m.card.duration, value: m.minutes(formatNumber(locale, exam.durationMinutes)) },
    {
      label: m.card.questions,
      value: m.questionsOf(
        formatNumber(locale, exam.questionsPerAttempt),
        formatNumber(locale, exam.questionCount),
      ),
    },
    { label: m.card.starts, value: formatDate(locale, exam.windowStart) },
  ];
  return (
    <Card className="flex w-full flex-col">
      <h2 className="break-words text-lg font-bold uppercase tracking-tight text-ink">
        {exam.title}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        {exam.category ? c.categories[exam.category] : m.allCategories}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={examStatusTone[exam.status]}>{c.examStatus[exam.status]}</Badge>
        {exam.locked ? (
          <Badge tone="neutral">
            <span className="inline-flex items-center gap-1">
              <Lock size={12} aria-hidden="true" />
              {m.locked}
            </span>
          </Badge>
        ) : null}
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-2 rounded-control border border-line bg-page p-3">
        {info.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              {item.label}
            </dt>
            <dd className="mt-0.5 break-words text-sm font-semibold text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-ink-muted">
        {m.card.windowCloses(formatDateTime(locale, exam.windowEnd))}
      </p>

      <div className="mt-auto pt-5">
        <Link
          href={`${PATH}/${encodeURIComponent(exam.id)}`}
          aria-label={m.card.viewLabel(exam.title)}
          className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'w-full' })}
        >
          <Eye size={16} aria-hidden="true" />
          {m.card.view}
        </Link>
      </div>
    </Card>
  );
}
