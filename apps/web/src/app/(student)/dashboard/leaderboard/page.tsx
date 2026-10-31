import type { Metadata } from 'next';
import Link from 'next/link';
import { Search, SearchX, Trophy, Users } from 'lucide-react';
import {
  buttonClasses,
  DataTable,
  EmptyState,
  LinkPagination,
  PageHeader,
  SearchBox,
  Tabs,
} from '@sirat/ui';
import { getData } from '@/data';
import { hrefWith, parseId, parsePageQuery, totalPages, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { leaderboardMessages } from '@/i18n/messages/leaderboard';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/dashboard/leaderboard';
const PAGE_SIZE = 20;
const FILTER_CARD =
  'mb-6 flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-card lg:flex-row lg:items-center lg:justify-between';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(leaderboardMessages);
  return { title: m.title };
}

/**
 * Student leaderboard: one page of the precomputed snapshot, searched (name or institution) and
 * paged on the server. The old page fetched 4,000 rows into the browser and polled every 15 s.
 * Rows carry rank, name, institution and status only: never score, time or email.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/dashboard/leaderboard');
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(leaderboardMessages),
    getMessages(common),
    getData(params),
  ]);
  const query = parsePageQuery(params, PAGE_SIZE);
  const view = await data.leaderboard.get({ ...query, roundId: parseId(params.round) });

  const rounds = [...view.rounds].sort((a, b) => a.sortOrder - b.sortOrder);
  // A round tab keeps the search but not the page: another round starts at its first page.
  const tabs =
    rounds.length > 0 ? (
      <Tabs
        items={rounds.map((r) => ({
          key: r.id,
          label: r.name,
          href: hrefWith(PATH, { round: r.id, q: query.q }),
        }))}
        activeKey={view.round?.id ?? ''}
        label={m.roundsLabel}
        linkAs={Link}
      />
    ) : null;

  if (view.status === 'unpublished') {
    return (
      <>
        <PageHeader title={m.title} subtitle={m.subtitleUnpublished} />
        {tabs ? <div className={FILTER_CARD}>{tabs}</div> : null}
        <section
          aria-labelledby="results-soon"
          className="rounded-card border border-line bg-surface px-6 py-14 text-center shadow-card"
        >
          <div aria-hidden="true" className="relative mx-auto mb-6 h-20 w-20">
            <span className="absolute -inset-2 rounded-full bg-primary-soft motion-safe:animate-pulse" />
            <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-primary-soft text-primary-strong ring-4 ring-surface">
              <Trophy size={36} />
            </span>
          </div>
          <h2 id="results-soon" className="text-2xl font-black tracking-tight text-ink md:text-3xl">
            {m.soon.title}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-ink-muted">
            {view.round ? m.soon.text(view.round.name) : m.soon.textNoRound}
          </p>
        </section>
      </>
    );
  }

  const round = view.round;
  const pages = totalPages(view.total, view.pageSize);
  // Rows have no id (by design); the position on the page is unique, ranks and names may repeat.
  const rows = view.items.map((row, index) => ({
    ...row,
    position: (view.page - 1) * view.pageSize + index,
  }));

  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.subtitlePublished(round.name, formatDateTime(locale, view.snapshotAt))}
      />
      <div className={FILTER_CARD}>
        {tabs}
        <SearchBox
          id="leaderboard-search"
          label={m.searchLabel}
          placeholder={m.searchPlaceholder}
          submitLabel={c.search.submit}
          defaultValue={query.q}
          action={PATH}
          preserve={{ round: round.id }}
          icon={<Search size={16} />}
        />
      </div>

      {view.total === 0 ? (
        <EmptyState
          icon={query.q ? <SearchX size={28} /> : <Users size={28} />}
          title={m.empty.title}
          description={query.q ? m.empty.searchText(query.q) : m.empty.text}
          action={
            query.q ? (
              <Link
                href={hrefWith(PATH, { round: round.id })}
                className={buttonClasses({ variant: 'outline', size: 'sm' })}
              >
                {m.empty.clear}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <DataTable
            caption={m.caption(round.name)}
            rows={rows}
            rowKey={(r) => String(r.position)}
            columns={[
              {
                key: 'rank',
                header: m.columns.rank,
                render: (r) => (
                  <span className="whitespace-nowrap text-lg font-black tabular-nums text-ink-muted">
                    {`#${formatNumber(locale, r.rank)}`}
                  </span>
                ),
              },
              {
                key: 'name',
                header: m.columns.name,
                render: (r) => <span className="font-bold text-ink">{r.name}</span>,
              },
              {
                key: 'institution',
                header: m.columns.institution,
                render: (r) => (
                  <>
                    {r.institution ? (
                      <span className="block font-semibold text-ink">{r.institution}</span>
                    ) : (
                      <span className="block text-ink-muted">{c.notProvided}</span>
                    )}
                    {r.entryStatus ? (
                      <span className="mt-1 block text-xs font-bold text-primary-strong">
                        {c.entryStatus[r.entryStatus]}
                      </span>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
          <LinkPagination
            page={view.page}
            totalPages={pages}
            linkAs={Link}
            hrefFor={(page) => hrefWith(PATH, { round: round.id, q: query.q, page })}
            label={c.pagination.label}
            prevLabel={c.pagination.prev}
            nextLabel={c.pagination.next}
            summary={c.pagination.summary(
              formatNumber(locale, view.page),
              formatNumber(locale, pages),
            )}
          />
        </>
      )}
    </>
  );
}
