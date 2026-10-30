import type { Metadata } from 'next';
import Link from 'next/link';
import { Calendar, Megaphone } from 'lucide-react';
import { Badge, EmptyState, LinkPagination, PageHeader } from '@sirat/ui';
import { getData } from '@/data';
import { hrefWith, parsePageQuery, totalPages, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDate, formatNumber } from '@/i18n/format';
import { announcementsMessages } from '@/i18n/messages/announcements';
import { getMessages } from '@/i18n/server';

/*
 * Announcements (old dashboard/announcement/page.jsx): newest first, one card per announcement,
 * paged on the server. Title and body are plain text from the API (rendered as text, never HTML).
 * Fixed from the old page: the title had literal parentheses, and the whole list was fetched in
 * the browser.
 */

const PAGE_SIZE = 10;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(announcementsMessages);
  return { title: m.title };
}

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(announcementsMessages),
    getMessages(common),
    getData(params),
  ]);
  const list = await data.student.listAnnouncements(parsePageQuery(params, PAGE_SIZE));
  const pages = totalPages(list.total, list.pageSize);
  return (
    <>
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary-strong md:h-14 md:w-14"
        >
          <Megaphone className="h-6 w-6 md:h-7 md:w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <PageHeader title={m.title} subtitle={m.subtitle} />
        </div>
      </div>
      {list.items.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-7 w-7" />}
          title={m.empty.title}
          description={m.empty.description}
        />
      ) : (
        <ul className="space-y-4 md:space-y-6">
          {list.items.map((item) => (
            <li key={item.id}>
              <article className="rounded-3xl border border-line bg-surface p-6 shadow-card">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <Badge tone="info">{m.badge}</Badge>
                  <span className="flex items-center gap-1.5 text-sm text-ink-muted">
                    <Calendar aria-hidden className="h-4 w-4" />
                    <time dateTime={item.publishedAt}>{formatDate(locale, item.publishedAt)}</time>
                  </span>
                </div>
                <h2 className="mb-2 break-words text-lg font-bold text-ink">{item.title}</h2>
                <p className="whitespace-pre-line break-words text-sm leading-relaxed text-ink-muted">
                  {item.body}
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}
      <LinkPagination
        page={list.page}
        totalPages={pages}
        linkAs={Link}
        hrefFor={(page) => hrefWith('/dashboard/announcements', { page })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(formatNumber(locale, list.page), formatNumber(locale, pages))}
      />
    </>
  );
}
