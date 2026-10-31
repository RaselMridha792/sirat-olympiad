import type { Metadata } from 'next';
import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { ANNOUNCEMENT_STATUSES, type AnnouncementStatus } from '@sirat/shared';
import { Badge, DataTable, EmptyState, LinkPagination, PageHeader, Tabs } from '@sirat/ui';
import { AnnouncementEditor } from '@/components/admin/AnnouncementEditor';
import { AnnouncementStateButton } from '@/components/admin/AnnouncementStateButton';
import { getData } from '@/data';
import { hrefWith, parseEnum, parsePageQuery, totalPages, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { adminAnnouncementsMessages } from '@/i18n/messages/admin-announcements';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/announcements';
const PAGE_SIZE = 10;

const STATUS_TONE: Record<AnnouncementStatus, 'success' | 'warning' | 'neutral'> = {
  published: 'success',
  scheduled: 'warning',
  archived: 'neutral',
};

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminAnnouncementsMessages);
  return { title: m.title };
}

/**
 * Announcements (old admin/announcement), on the API (core C4): every status, newest first, paged on the server.
 * Writing, editing, archiving and restoring go from the browser through lib/api.ts, each with the version the admin
 * saw (409 stale otherwise) and an audit row. Texts are plain text, shown with their line breaks.
 */
export default async function AdminAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/admin/announcements');
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminAnnouncementsMessages),
    getMessages(common),
    getData(params),
  ]);
  const { page, pageSize } = parsePageQuery(params, PAGE_SIZE);
  const status = parseEnum(params.status, ANNOUNCEMENT_STATUSES);
  const list = await data.admin.listAnnouncements({ page, pageSize, status });
  const pages = totalPages(list.total, list.pageSize);
  const tabs = [
    { key: 'all', label: m.tabs.all, href: PATH },
    ...ANNOUNCEMENT_STATUSES.map((s) => ({
      key: s,
      label: m.tabs[s],
      href: hrefWith(PATH, { status: s }),
    })),
  ];

  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.count(formatNumber(locale, list.total), list.total)}
        actions={<AnnouncementEditor locale={locale} categoryLabels={c.categories} />}
      />
      <div className="mb-4">
        <Tabs items={tabs} activeKey={status ?? 'all'} label={m.tabs.label} linkAs={Link} />
      </div>

      {list.items.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={26} />}
          title={m.empty.title}
          description={status ? m.empty.filtered : m.empty.text}
        />
      ) : (
        <DataTable
          caption={m.table.caption}
          rows={list.items}
          rowKey={(item) => item.id}
          columns={[
            {
              key: 'details',
              header: m.table.details,
              className: 'min-w-72 px-5 py-4 align-top text-sm text-ink',
              render: (item) => (
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-secondary-soft text-secondary"
                  >
                    <Megaphone size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-base font-bold text-ink">{item.title}</p>
                    <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-muted">
                      {item.body}
                    </p>
                    {item.authorName ? (
                      <p className="mt-2 text-xs text-ink-faint">{m.by(item.authorName)}</p>
                    ) : null}
                  </div>
                </div>
              ),
            },
            {
              key: 'audience',
              header: m.table.audience,
              className: 'whitespace-nowrap px-5 py-4 align-top text-sm text-ink',
              render: (item) => (item.category ? c.categories[item.category] : m.everyone),
            },
            {
              key: 'status',
              header: m.table.status,
              className: 'px-5 py-4 align-top',
              render: (item) => (
                <Badge tone={STATUS_TONE[item.status]}>{m.status[item.status]}</Badge>
              ),
            },
            {
              key: 'published',
              header: m.table.published,
              className: 'whitespace-nowrap px-5 py-4 align-top text-sm font-medium text-ink',
              render: (item) => (
                <time dateTime={item.publishedAt}>{formatDateTime(locale, item.publishedAt)}</time>
              ),
            },
            {
              key: 'actions',
              header: m.table.actions,
              headerClassName: 'text-right',
              className: 'px-5 py-3 text-right align-top',
              render: (item) => (
                <div className="flex justify-end gap-1">
                  {item.status !== 'archived' ? (
                    <AnnouncementEditor
                      locale={locale}
                      categoryLabels={c.categories}
                      announcement={{
                        id: item.id,
                        title: item.title,
                        body: item.body,
                        category: item.category,
                        publishedAt: item.publishedAt,
                        updatedAt: item.updatedAt,
                      }}
                    />
                  ) : null}
                  <AnnouncementStateButton
                    locale={locale}
                    id={item.id}
                    updatedAt={item.updatedAt}
                    archived={item.status === 'archived'}
                  />
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
        hrefFor={(target) => hrefWith(PATH, { page: target, status })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(formatNumber(locale, list.page), formatNumber(locale, pages))}
      />
    </>
  );
}
