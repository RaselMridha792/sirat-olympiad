import type { Metadata } from 'next';
import Link from 'next/link';
import { Search, Users } from 'lucide-react';
import {
  Avatar,
  Badge,
  buttonClasses,
  DataTable,
  EmptyState,
  LinkPagination,
  PageHeader,
  SearchBox,
} from '@sirat/ui';
import { rankTone } from '@/components/status';
import { getData } from '@/data';
import { hrefWith, parsePageQuery, totalPages, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDate, formatNumber } from '@/i18n/format';
import { adminAmbassadorsMessages } from '@/i18n/messages/admin-ambassadors';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/ambassadors';
const PAGE_SIZE = 20;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminAmbassadorsMessages);
  return { title: m.title };
}

/**
 * Admin ambassador list (old admin/ambassadors-list): server-side search by name, email or promo
 * code, and server-side paging. The old page cached the whole list, personal data included, in
 * browser storage, then filtered and paged it on the client. Read-only: approve/edit actions stay
 * hidden until audited admin endpoints exist (owner decision).
 */
export default async function AdminAmbassadorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/admin/ambassadors');
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminAmbassadorsMessages),
    getMessages(common),
    getData(params),
  ]);
  const query = parsePageQuery(params, PAGE_SIZE);
  const list = await data.admin.listAmbassadors(query);
  const pages = totalPages(list.total, list.pageSize);

  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.subtitle(formatNumber(locale, list.total))}
        actions={
          <SearchBox
            id="ambassador-search"
            action={PATH}
            defaultValue={query.q}
            label={m.search.label}
            placeholder={m.search.placeholder}
            submitLabel={c.search.submit}
            icon={<Search aria-hidden="true" size={16} />}
          />
        }
      />

      {list.items.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden="true" size={24} />}
          title={m.empty.title}
          description={query.q ? m.empty.filtered : m.empty.none}
          action={
            query.q ? (
              <Link href={PATH} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                {m.empty.showAll}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          caption={m.table.caption}
          rows={list.items}
          rowKey={(a) => a.userId}
          columns={[
            {
              key: 'ambassador',
              header: m.table.ambassador,
              render: (a) => (
                <div className="flex items-center gap-3">
                  <Avatar name={a.name} size="sm" />
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{a.name}</p>
                    <p className="text-xs text-ink-muted">{a.email}</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'code',
              header: m.table.promoCode,
              render: (a) => (
                <span className="whitespace-nowrap rounded-control border border-line bg-page px-2 py-1 font-mono text-xs font-bold text-ink">
                  {a.promoCode}
                </span>
              ),
            },
            {
              key: 'referrals',
              header: m.table.referrals,
              headerClassName: 'text-center',
              className: 'px-5 py-4 text-center',
              render: (a) => (
                <Badge tone="success">
                  <span className="inline-flex items-center gap-1">
                    <Users aria-hidden="true" size={12} />
                    {formatNumber(locale, a.referralCount)}
                  </span>
                </Badge>
              ),
            },
            {
              key: 'points',
              header: m.table.points,
              className: 'px-5 py-4 text-sm font-semibold tabular-nums text-ink',
              render: (a) => formatNumber(locale, a.points),
            },
            {
              key: 'rank',
              header: m.table.rank,
              render: (a) =>
                a.rankName ? (
                  <Badge tone={rankTone(a.rankName)}>{a.rankName}</Badge>
                ) : (
                  <span className="text-ink-muted">{m.noRank}</span>
                ),
            },
            {
              key: 'approved',
              header: m.table.approved,
              className: 'whitespace-nowrap px-5 py-4 text-sm text-ink',
              render: (a) =>
                a.approvedAt ? (
                  formatDate(locale, a.approvedAt)
                ) : (
                  <Badge tone="warning">{m.pendingApproval}</Badge>
                ),
            },
            {
              key: 'joined',
              header: m.table.joined,
              className: 'whitespace-nowrap px-5 py-4 text-sm text-ink-muted',
              render: (a) => formatDate(locale, a.createdAt),
            },
          ]}
        />
      )}

      <LinkPagination
        page={list.page}
        totalPages={pages}
        linkAs={Link}
        hrefFor={(page) => hrefWith(PATH, { q: query.q, page })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(formatNumber(locale, list.page), formatNumber(locale, pages))}
      />
    </>
  );
}
