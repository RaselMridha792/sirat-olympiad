import type { Metadata } from 'next';
import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { DataTable, EmptyState, LinkPagination, PageHeader } from '@sirat/ui';
import { getData } from '@/data';
import { hrefWith, parsePageQuery, totalPages, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { adminAnnouncementsMessages } from '@/i18n/messages/admin-announcements';
import { getMessages } from '@/i18n/server';

const PATH = '/admin/announcements';
const PAGE_SIZE = 10;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminAnnouncementsMessages);
  return { title: m.title };
}

/**
 * Announcement list (old admin/announcement). Read-only for now: add, edit and delete stay hidden
 * until their endpoints exist. Newest first, paged on the server.
 */
export default async function AdminAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminAnnouncementsMessages),
    getMessages(common),
    getData(params),
  ]);
  // GET /admin/announcements takes only the page (no search).
  const { page, pageSize } = parsePageQuery(params, PAGE_SIZE);
  const list = await data.admin.listAnnouncements({ page, pageSize });
  const pages = totalPages(list.total, list.pageSize);

  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.count(formatNumber(locale, list.total), list.total)}
      />

      {list.items.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={26} />}
          title={m.empty.title}
          description={m.empty.text}
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
                    {/* Full text: with editing hidden, this is the only place admins can read it. */}
                    <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-muted">
                      {item.body}
                    </p>
                  </div>
                </div>
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
          ]}
        />
      )}

      <LinkPagination
        page={list.page}
        totalPages={pages}
        linkAs={Link}
        hrefFor={(target) => hrefWith(PATH, { page: target })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(formatNumber(locale, list.page), formatNumber(locale, pages))}
      />
    </>
  );
}
