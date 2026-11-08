import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipboardList, ClipboardCheck } from 'lucide-react';
import { DataTable, EmptyState, LinkPagination, PageHeader, Tabs } from '@sirat/ui';
import { DemoBadge } from '@/components/admin/demo/DemoBadge';
import { TaskDecision } from '@/components/admin/TaskDecision';
import { TaskEditor } from '@/components/admin/TaskEditor';
import { TaskStateButton } from '@/components/admin/TaskStateButton';
import { getData } from '@/data';
import { first, hrefWith, parsePageQuery, totalPages, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { adminTasksMessages } from '@/i18n/messages/admin-tasks';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/tasks';
const PAGE_SIZE = 20;
const VIEWS = ['active', 'archived', 'review'] as const;
type View = (typeof VIEWS)[number];

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminTasksMessages);
  return { title: m.title };
}

/**
 * Ambassador tasks (core C5b-2; admin only): active and archived tasks with their assignment counts, and the review
 * queue of submitted proofs (oldest first). Every write goes from the browser through lib/api.ts. A proof is shown
 * as plain text only: a pasted link is never made clickable (lead). Assigning is done on /admin/ambassadors.
 */
export default async function AdminTasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminTasksMessages),
    getMessages(common),
    getData(params),
  ]);
  const raw = first(params.view);
  const view: View = (VIEWS as readonly string[]).includes(raw ?? '') ? (raw as View) : 'active';
  const { page, pageSize } = parsePageQuery(params, PAGE_SIZE);
  const tabs = VIEWS.map((v) => ({ key: v, label: m.tabs[v], href: hrefWith(PATH, { view: v }) }));
  const n = (value: number) => formatNumber(locale, value);

  const header = (
    <>
      <PageHeader title={m.title} subtitle={m.subtitle} actions={<TaskEditor locale={locale} />} />
      <div className="mb-4">
        <Tabs items={tabs} activeKey={view} label={m.tabs.label} linkAs={Link} />
      </div>
    </>
  );

  if (view === 'review') {
    const list = await data.admin.listTaskReviews({ page, pageSize });
    const pages = totalPages(list.total, list.pageSize);
    return (
      <>
        {header}
        {list.items.length === 0 ? (
          <EmptyState icon={<ClipboardCheck size={26} />} title={m.empty.review} />
        ) : (
          <>
            <p className="mb-2 text-xs text-ink-faint">{m.review.proofNote}</p>
            <DataTable
              caption={m.review.caption}
              rows={list.items}
              rowKey={(r) => r.assignmentId}
              columns={[
                {
                  key: 'task',
                  header: m.review.task,
                  className: 'min-w-56 px-5 py-4 align-top text-sm text-ink',
                  render: (r) => (
                    <div>
                      <p className="flex flex-wrap items-center gap-2 font-bold text-ink">
                        {r.taskTitle}
                        <DemoBadge demo={r.demo} locale={locale} />
                      </p>
                      <p className="mt-1 text-xs text-secondary">{m.pointsValue(n(r.points))}</p>
                    </div>
                  ),
                },
                {
                  key: 'ambassador',
                  header: m.review.ambassador,
                  className: 'whitespace-nowrap px-5 py-4 align-top text-sm text-ink',
                  render: (r) => r.ambassador.name,
                },
                {
                  key: 'proof',
                  header: m.review.proof,
                  className: 'min-w-72 px-5 py-4 align-top text-sm text-ink',
                  // Text only: React escapes it, and nothing here turns a link into an anchor.
                  render: (r) => <p className="whitespace-pre-line break-words">{r.proof}</p>,
                },
                {
                  key: 'submitted',
                  header: m.review.submitted,
                  className: 'whitespace-nowrap px-5 py-4 align-top text-sm text-ink-muted',
                  render: (r) => (
                    <time dateTime={r.submittedAt}>{formatDateTime(locale, r.submittedAt)}</time>
                  ),
                },
                {
                  key: 'actions',
                  header: m.review.actions,
                  headerClassName: 'text-right',
                  className: 'px-5 py-3 text-right align-top',
                  render: (r) => (
                    <TaskDecision locale={locale} assignmentId={r.assignmentId} points={r.points} />
                  ),
                },
              ]}
            />
          </>
        )}
        <LinkPagination
          page={list.page}
          totalPages={pages}
          linkAs={Link}
          hrefFor={(p) => hrefWith(PATH, { view, page: p })}
          label={c.pagination.label}
          prevLabel={c.pagination.prev}
          nextLabel={c.pagination.next}
          summary={c.pagination.summary(n(list.page), n(pages))}
        />
      </>
    );
  }

  const list = await data.admin.listTasks({ page, pageSize, status: view });
  const pages = totalPages(list.total, list.pageSize);
  return (
    <>
      {header}
      {list.items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={26} />}
          title={view === 'archived' ? m.empty.archived : m.empty.active}
        />
      ) : (
        <DataTable
          caption={m.table.caption}
          rows={list.items}
          rowKey={(t) => t.id}
          columns={[
            {
              key: 'task',
              header: m.table.task,
              className: 'min-w-72 px-5 py-4 align-top text-sm text-ink',
              render: (t) => (
                <div>
                  <p className="flex flex-wrap items-center gap-2 text-base font-bold text-ink">
                    {t.title}
                    <DemoBadge demo={t.demo} locale={locale} />
                  </p>
                  <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-muted">
                    {t.description}
                  </p>
                </div>
              ),
            },
            {
              key: 'points',
              header: m.table.points,
              className:
                'whitespace-nowrap px-5 py-4 align-top text-sm font-semibold tabular-nums text-ink',
              render: (t) => n(t.points),
            },
            {
              key: 'progress',
              header: m.table.progress,
              className: 'px-5 py-4 align-top text-sm text-ink-muted',
              render: (t) =>
                m.counts(
                  n(t.counts.assigned),
                  n(t.counts.submitted),
                  n(t.counts.approved),
                  n(t.counts.rejected),
                ),
            },
            {
              key: 'actions',
              header: m.table.actions,
              headerClassName: 'text-right',
              className: 'px-5 py-3 text-right align-top',
              render: (t) => (
                <div className="flex flex-wrap justify-end gap-1">
                  {t.archivedAt ? null : (
                    <TaskEditor
                      locale={locale}
                      task={{
                        id: t.id,
                        title: t.title,
                        description: t.description,
                        points: t.points,
                        updatedAt: t.updatedAt,
                      }}
                    />
                  )}
                  <TaskStateButton locale={locale} taskId={t.id} archived={t.archivedAt !== null} />
                </div>
              ),
            },
          ]}
        />
      )}
      <LinkPagination
        page={list.page}
        totalPages={pages}
        linkAs={Link}
        hrefFor={(p) => hrefWith(PATH, { view, page: p })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(n(list.page), n(pages))}
      />
    </>
  );
}
