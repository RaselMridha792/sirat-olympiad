import type { ReactNode } from 'react';
import Link from 'next/link';
import { Eye, Search, ShieldAlert, Users } from 'lucide-react';
import {
  ATTEMPT_STATUSES,
  type AdminAttemptDetail,
  type AdminAttemptRow,
  type AdminExamView,
  type ExamResultsStatus,
  type Paginated,
} from '@sirat/shared';
import {
  Badge,
  buttonClasses,
  Card,
  DataTable,
  EmptyState,
  LinkPagination,
  SearchBox,
  Tabs,
} from '@sirat/ui';
import { LinkPendingIcon } from '@/components/LinkPendingIcon';
import { attemptStatusTone } from '@/components/status';
import { RouteDialog } from '@/components/RouteDialog';
import { hrefWith, totalPages } from '@/data/query';
import type { Locale } from '@/i18n';
import type { common } from '@/i18n/common';
import { formatDateTime, formatDuration, formatNumber } from '@/i18n/format';
import type { Messages } from '@/i18n/messages';
import type { adminExamResultsMessages } from '@/i18n/messages/admin-exam-results';
import { ResultsActions } from './ResultsActions';

/*
 * The results and attempts of one exam on the admin exam page (EXAM-PLAN 3.12; owner Q4 and Q5). Server-rendered
 * from the page's reads; only the build/publish buttons run in the browser. The attempt dialog lives in the URL
 * (`?attempt=<id>`), like the user dialog on /admin/users.
 */

type M = Messages<typeof adminExamResultsMessages>;
type C = Messages<typeof common>;

export const ATTEMPT_FILTERS = ['violations', 'min3'] as const;
export type AttemptFilter = (typeof ATTEMPT_FILTERS)[number];
/** "3 or more violations": half way to the end of the exam (owner Q4: the 6th ends it). */
export const MIN_VIOLATIONS_FILTER = 3;

export function ExamResultsSection({
  exam,
  results,
  locale,
  m,
}: {
  exam: AdminExamView;
  results: ExamResultsStatus;
  locale: Locale;
  m: M;
}) {
  const n = (v: number) => formatNumber(locale, v);
  const r = m.results;
  return (
    <section aria-labelledby="exam-results" className="mb-10">
      <h2
        id="exam-results"
        className="mb-4 border-l-4 border-secondary pl-3 text-xl font-black text-ink"
      >
        {r.heading}
      </h2>
      <Card className="space-y-5">
        <p className="text-sm font-semibold text-ink">
          {results.windowClosed ? r.windowClosed : r.windowOpen}
        </p>
        <dl aria-label={r.counts.label} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ATTEMPT_STATUSES.map((status) => (
            <div key={status} className="rounded-control border border-line bg-page p-3">
              <dt className="text-xs font-bold uppercase tracking-wider text-ink-faint">
                {r.counts[status]}
              </dt>
              <dd className="mt-1 text-2xl font-black tabular-nums text-ink">
                {n(results.counts[status])}
              </dd>
            </div>
          ))}
        </dl>
        <ul className="space-y-1 text-sm text-ink">
          <li>
            {results.snapshotAt
              ? r.snapshot(formatDateTime(locale, results.snapshotAt), n(results.generation))
              : r.noSnapshot}
          </li>
          <li>
            {results.publishedAt
              ? r.published(formatDateTime(locale, results.publishedAt))
              : r.notPublished}
          </li>
        </ul>
        <ResultsActions
          locale={locale}
          examId={exam.id}
          updatedAt={exam.updatedAt}
          canBuild={results.canBuild}
          canPublish={results.canPublish}
          published={results.publishedAt !== null}
        />
      </Card>
    </section>
  );
}

export function ExamAttemptsSection({
  path,
  list,
  filter,
  q,
  attemptId,
  detail,
  warnings,
  locale,
  m,
  c,
}: {
  /** This exam's page, the base of every link here. */
  path: string;
  list: Paginated<AdminAttemptRow>;
  filter: AttemptFilter | undefined;
  q: string | undefined;
  /** `?attempt=` from the URL (the dialog is open while it is set). */
  attemptId: string | undefined;
  detail: AdminAttemptDetail | null;
  /** After this many warnings the next violation ends the exam. */
  warnings: number;
  locale: Locale;
  m: M;
  c: C;
}) {
  const a = m.attempts;
  const n = (v: number) => formatNumber(locale, v);
  const pages = totalPages(list.total, list.pageSize);
  const here = { filter, q, page: list.page };
  const none = <span className="text-ink-muted">{a.none}</span>;
  const filters = [
    { key: 'all', label: a.filters.all, href: hrefWith(path, { q }) },
    {
      key: 'violations',
      label: a.filters.violations,
      href: hrefWith(path, { filter: 'violations', q }),
    },
    {
      key: 'min3',
      label: a.filters.atLeast(n(MIN_VIOLATIONS_FILTER)),
      href: hrefWith(path, { filter: 'min3', q }),
    },
  ];

  return (
    <section aria-labelledby="exam-attempts" className="mb-10">
      <h2
        id="exam-attempts"
        className="mb-4 border-l-4 border-secondary pl-3 text-xl font-black text-ink"
      >
        {a.heading(n(list.total))}
      </h2>
      <Card className="mb-4 flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <Tabs items={filters} activeKey={filter ?? 'all'} label={a.filters.label} linkAs={Link} />
        <SearchBox
          id="attempt-search"
          label={a.search.label}
          placeholder={a.search.placeholder}
          submitLabel={c.search.submit}
          defaultValue={q}
          action={path}
          preserve={{ filter }}
          icon={<Search size={16} />}
        />
      </Card>

      {list.items.length === 0 ? (
        <EmptyState
          icon={<Users size={26} />}
          title={a.empty.title}
          description={filter || q ? a.empty.filtered : a.empty.text}
          action={
            filter || q ? (
              <Link href={path} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                {a.empty.clear}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          caption={a.table.caption}
          rows={list.items}
          rowKey={(row) => row.attemptId}
          columns={[
            {
              key: 'student',
              header: a.table.student,
              className: 'min-w-56 px-5 py-4 text-sm text-ink',
              render: (row) => (
                <>
                  <span className="block font-bold text-ink">{row.name}</span>
                  <span className="block break-all text-xs text-ink-muted">{row.email}</span>
                </>
              ),
            },
            {
              key: 'status',
              header: a.table.status,
              render: (row) => (
                <Badge tone={attemptStatusTone[row.status]}>{a.status[row.status]}</Badge>
              ),
            },
            {
              key: 'ended',
              header: a.table.ended,
              render: (row) =>
                row.endReason === null ? (
                  none
                ) : (
                  <Badge tone={row.endReason === 'violations' ? 'danger' : 'neutral'}>
                    {a.endReason[row.endReason]}
                  </Badge>
                ),
            },
            {
              key: 'violations',
              header: a.table.violations,
              className: 'px-5 py-4 text-sm tabular-nums',
              render: (row) => (
                <ViolationCount
                  count={row.violationCount}
                  warnings={warnings}
                  locale={locale}
                  none={none}
                />
              ),
            },
            {
              key: 'started',
              header: a.table.started,
              className: 'whitespace-nowrap px-5 py-4 text-sm text-ink-muted',
              render: (row) => formatDateTime(locale, row.startedAt),
            },
            {
              key: 'time',
              header: a.table.time,
              className: 'whitespace-nowrap px-5 py-4 text-sm tabular-nums text-ink-muted',
              render: (row) =>
                row.timeTakenSeconds === null ? none : formatDuration(locale, row.timeTakenSeconds),
            },
            {
              key: 'score',
              header: a.table.score,
              headerClassName: 'text-right',
              className: 'px-5 py-4 text-right text-sm font-bold tabular-nums text-ink',
              render: (row) => (row.score === null ? none : n(row.score)),
            },
            {
              key: 'details',
              header: a.table.details,
              headerClassName: 'text-right',
              className: 'px-5 py-3 text-right',
              // `replace`: opening and closing the dialog swap one history entry (RouteDialog).
              render: (row) => (
                <Link
                  href={hrefWith(path, { ...here, attempt: row.attemptId })}
                  replace
                  scroll={false}
                  aria-label={a.view(row.name)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-secondary-soft hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                >
                  <LinkPendingIcon size={18}>
                    <Eye aria-hidden="true" size={18} />
                  </LinkPendingIcon>
                </Link>
              ),
            },
          ]}
        />
      )}

      <LinkPagination
        page={list.page}
        totalPages={pages}
        linkAs={Link}
        hrefFor={(page) => hrefWith(path, { filter, q, page })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(n(list.page), n(pages))}
      />

      {attemptId ? (
        <RouteDialog
          key={attemptId}
          title={detail ? a.dialog.title(detail.name) : a.dialog.notFoundTitle}
          closeLabel={c.states.close}
          closeHref={hrefWith(path, here)}
        >
          {detail ? (
            <AttemptEvents detail={detail} warnings={warnings} locale={locale} m={m} none={none} />
          ) : (
            <p className="text-sm text-ink-muted">{a.dialog.notFound}</p>
          )}
        </RouteDialog>
      ) : null}
    </section>
  );
}

/** Red once the count ended the exam, amber with any violation, plain otherwise. */
function ViolationCount({
  count,
  warnings,
  locale,
  none,
}: {
  count: number | null;
  warnings: number;
  locale: Locale;
  none: ReactNode;
}) {
  if (count === null) return none;
  const text = formatNumber(locale, count);
  if (count > warnings) return <Badge tone="danger">{text}</Badge>;
  if (count > 0) return <Badge tone="warning">{text}</Badge>;
  return <span className="text-ink-muted">{text}</span>;
}

function AttemptEvents({
  detail,
  warnings,
  locale,
  m,
  none,
}: {
  detail: AdminAttemptDetail;
  warnings: number;
  locale: Locale;
  m: M;
  none: ReactNode;
}) {
  const a = m.attempts;
  return (
    <div className="space-y-5">
      <p className="break-all text-sm text-ink-muted">{detail.email}</p>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs font-bold uppercase tracking-wider text-ink-faint">
            {a.table.ended}
          </dt>
          <dd className="mt-1 text-ink">
            {detail.endReason ? a.endReason[detail.endReason] : a.status[detail.status]}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wider text-ink-faint">
            {a.table.violations}
          </dt>
          <dd className="mt-1">
            <ViolationCount
              count={detail.violationCount}
              warnings={warnings}
              locale={locale}
              none={none}
            />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wider text-ink-faint">
            {a.table.time}
          </dt>
          <dd className="mt-1 tabular-nums text-ink">
            {detail.timeTakenSeconds === null
              ? none
              : formatDuration(locale, detail.timeTakenSeconds)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wider text-ink-faint">
            {a.table.score}
          </dt>
          <dd className="mt-1 font-bold tabular-nums text-ink">
            {detail.score === null ? none : formatNumber(locale, detail.score)}
          </dd>
        </div>
      </dl>
      <div>
        <h3 className="mb-2 text-sm font-bold text-ink">{a.dialog.events}</h3>
        {detail.events.length === 0 ? (
          <p className="text-sm text-ink-muted">{a.dialog.noEvents}</p>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {detail.events.map((event, index) => {
              const violation = event.type === 'leave' || event.type === 'devtools';
              return (
                <li key={index} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 font-mono tabular-nums text-ink-muted">
                    {formatDuration(locale, event.at)}
                  </span>
                  {violation ? (
                    <ShieldAlert
                      aria-hidden="true"
                      size={16}
                      className="shrink-0 text-danger-strong"
                    />
                  ) : (
                    <span aria-hidden="true" className="w-4 shrink-0" />
                  )}
                  <span className={violation ? 'font-semibold text-danger-strong' : 'text-ink'}>
                    {a.dialog.event[event.type]}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
