import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock, Eye, EyeOff, Info, Search, Trophy, Users } from 'lucide-react';
import { CATEGORIES, type AdminLeaderboardRow } from '@sirat/shared';
import {
  Avatar,
  Badge,
  Card,
  cn,
  DataTable,
  EmptyState,
  LinkPagination,
  PageHeader,
  SearchBox,
  Tabs,
} from '@sirat/ui';
import { entryStatusTone } from '@/components/status';
import { getData } from '@/data';
import {
  hrefWith,
  parseEnum,
  parseId,
  parsePageQuery,
  totalPages,
  type SearchParams,
} from '@/data/query';
import type { Locale } from '@/i18n';
import { common } from '@/i18n/common';
import { formatDateTime, formatDuration, formatNumber } from '@/i18n/format';
import type { Messages } from '@/i18n/messages';
import { adminLeaderboardMessages } from '@/i18n/messages/admin-leaderboard';
import { getMessages } from '@/i18n/server';

const PATH = '/admin/leaderboard';
const PAGE_SIZE = 20;

type M = Messages<typeof adminLeaderboardMessages>;
type C = Messages<typeof common>;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminLeaderboardMessages);
  return { title: m.title };
}

/**
 * Staff view of the precomputed snapshot: scores, times and categories (students never get these).
 * Paging, search and filters are server-side. The public/hidden switch stays read-only until the
 * settings endpoint exists (owner decision), so only its state is shown.
 */
export default async function AdminLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminLeaderboardMessages),
    getMessages(common),
    getData(params),
  ]);
  const query = parsePageQuery(params, PAGE_SIZE);
  const category = parseEnum(params.category, CATEGORIES);
  const view = await data.admin.getLeaderboard({
    ...query,
    roundId: parseId(params.round),
    category,
  });

  const roundId = view.round?.id;
  const pages = totalPages(view.total, view.pageSize);
  const filtered = Boolean(query.q || category);
  // Medals only for the real top three: a search or category filter would crown the wrong people.
  const podium =
    view.page === 1 && !filtered && view.items.length >= 3 ? view.items.slice(0, 3) : [];
  // As on the old page, the table starts after the podium; the podium cards carry the same data.
  const tableRows = podium.length === 3 ? view.items.slice(3) : view.items;
  const dash = <span className="font-normal text-ink-muted">{m.none}</span>;

  const roundTabs = view.rounds.map((round) => ({
    key: round.id,
    label: round.name,
    href: hrefWith(PATH, { round: round.id, category, q: query.q }),
  }));
  const categoryTabs = [
    {
      key: 'all',
      label: m.filters.allCategories,
      href: hrefWith(PATH, { round: roundId, q: query.q }),
    },
    ...CATEGORIES.map((key) => ({
      key,
      label: c.categories[key],
      href: hrefWith(PATH, { round: roundId, category: key, q: query.q }),
    })),
  ];

  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        actions={<PublicStatus isPublic={view.isPublic} m={m} />}
      />

      <Card className="mb-6 flex flex-col gap-4 px-4 py-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
        {roundTabs.length > 0 ? (
          <Tabs
            items={roundTabs}
            activeKey={roundId ?? ''}
            label={m.filters.rounds}
            linkAs={Link}
          />
        ) : null}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Tabs
            items={categoryTabs}
            activeKey={category ?? 'all'}
            label={m.filters.categories}
            linkAs={Link}
          />
          <SearchBox
            id="admin-leaderboard-search"
            defaultValue={query.q}
            label={m.filters.searchLabel}
            placeholder={m.filters.searchPlaceholder}
            submitLabel={c.search.submit}
            action={PATH}
            preserve={{ round: roundId, category }}
            icon={<Search size={16} />}
          />
        </div>
      </Card>

      {view.snapshotAt === null ? (
        <EmptyState
          icon={<Trophy size={26} />}
          title={view.round ? m.empty.notComputed(view.round.name) : m.empty.notComputedAny}
          description={m.empty.notComputedText}
        />
      ) : (
        <>
          <p className="mb-4 flex items-center gap-2 text-sm text-ink-muted">
            <Info size={16} aria-hidden="true" className="shrink-0" />
            {m.snapshot(formatDateTime(locale, view.snapshotAt))}
          </p>

          {view.items.length === 0 ? (
            <EmptyState
              icon={<Users size={26} />}
              title={m.empty.noMatch}
              description={filtered ? m.empty.noMatchText : m.empty.noEntriesText}
              action={
                filtered ? (
                  <Link
                    href={hrefWith(PATH, { round: roundId })}
                    className="text-sm font-semibold text-secondary underline-offset-4 hover:underline"
                  >
                    {m.empty.clear}
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              {podium.length === 3 ? (
                <ol
                  aria-label={m.podium.label}
                  className="mb-8 mt-8 grid gap-10 md:grid-cols-3 md:items-end md:gap-6"
                >
                  {podium.map((row, index) => (
                    <PodiumCard
                      key={row.userId}
                      row={row}
                      place={index}
                      locale={locale}
                      m={m}
                      c={c}
                    />
                  ))}
                </ol>
              ) : null}

              {tableRows.length > 0 ? (
                <DataTable
                  caption={m.table.caption(view.round?.name ?? m.title)}
                  rows={tableRows}
                  rowKey={(row) => row.userId}
                  columns={[
                    {
                      key: 'rank',
                      header: m.table.rank,
                      className: 'whitespace-nowrap px-5 py-4 text-base font-black text-ink-muted',
                      render: (row) => m.rankNo(formatNumber(locale, row.rank)),
                    },
                    {
                      key: 'participant',
                      header: m.table.participant,
                      className: 'min-w-56 px-5 py-4 text-sm text-ink',
                      render: (row) => (
                        <div className="flex items-center gap-3">
                          <Avatar name={row.name} size="sm" />
                          <div className="min-w-0">
                            <p className="font-bold text-ink">{row.name}</p>
                            <p className="break-all text-xs text-ink-muted">{row.email}</p>
                            {row.institution ? (
                              <p className="text-xs text-ink-muted">{row.institution}</p>
                            ) : null}
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: 'category',
                      header: m.table.category,
                      render: (row) =>
                        row.category ? (
                          <Badge tone="brand">{c.categories[row.category]}</Badge>
                        ) : (
                          dash
                        ),
                    },
                    {
                      key: 'score',
                      header: m.table.score,
                      headerClassName: 'text-right',
                      className: 'px-5 py-4 text-right text-sm font-bold tabular-nums text-ink',
                      render: (row) =>
                        row.score === null ? dash : formatNumber(locale, row.score),
                    },
                    {
                      key: 'time',
                      header: m.table.time,
                      className: 'whitespace-nowrap px-5 py-4 text-sm tabular-nums text-ink-muted',
                      render: (row) =>
                        row.timeTakenSeconds === null
                          ? dash
                          : formatDuration(locale, row.timeTakenSeconds),
                    },
                    {
                      key: 'status',
                      header: m.table.status,
                      render: (row) =>
                        row.entryStatus ? (
                          <Badge tone={entryStatusTone[row.entryStatus]}>
                            {c.entryStatus[row.entryStatus]}
                          </Badge>
                        ) : (
                          dash
                        ),
                    },
                  ]}
                />
              ) : null}
            </>
          )}
        </>
      )}

      <LinkPagination
        page={view.page}
        totalPages={pages}
        linkAs={Link}
        hrefFor={(page) => hrefWith(PATH, { round: roundId, category, q: query.q, page })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(formatNumber(locale, view.page), formatNumber(locale, pages))}
      />
    </>
  );
}

/** Read-only: shows whether the board is public. No toggle until the settings API exists. */
function PublicStatus({ isPublic, m }: { isPublic: boolean; m: M }) {
  return (
    <Card className="flex items-center gap-4 px-5 py-4">
      <span
        aria-hidden="true"
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
          isPublic ? 'bg-success-soft text-success-strong' : 'bg-danger-soft text-danger-strong',
        )}
      >
        {isPublic ? <Eye size={22} /> : <EyeOff size={22} />}
      </span>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-ink-faint">
          {m.publicStatus.label}
        </p>
        <p className="text-lg font-black text-ink">
          {isPublic ? m.publicStatus.live : m.publicStatus.hidden}
        </p>
      </div>
    </Card>
  );
}

const TIERS = {
  gold: {
    card: 'border-rank-gold bg-rank-gold/10',
    badge: 'bg-rank-gold text-ink',
    ring: 'ring-rank-gold',
  },
  silver: {
    card: 'border-rank-silver bg-surface',
    badge: 'bg-rank-silver text-ink',
    ring: 'ring-rank-silver',
  },
  bronze: {
    card: 'border-rank-bronze bg-surface',
    badge: 'bg-rank-bronze text-white',
    ring: 'ring-rank-bronze',
  },
} as const;

/** Medal colour follows the real rank (ties share it); the layout follows the list position. */
const tierOf = (rank: number) =>
  rank <= 1 ? TIERS.gold : rank === 2 ? TIERS.silver : TIERS.bronze;

/** List position -> 2-1-3 podium on wide screens (first place in the middle and taller). */
const PLACES = [
  'md:order-2 md:min-h-96',
  'md:order-1 md:min-h-80',
  'md:order-3 md:min-h-80',
] as const;

/** The table skips the podium rows, so each card shows everything their table row would. */
function PodiumCard({
  row,
  place,
  locale,
  m,
  c,
}: {
  row: AdminLeaderboardRow;
  place: number;
  locale: Locale;
  m: M;
  c: C;
}) {
  const tier = tierOf(row.rank);
  const rank = formatNumber(locale, row.rank);
  const first = place === 0;
  return (
    <li
      className={cn(
        'relative flex flex-col items-center rounded-card border-2 px-4 pb-6 pt-10 text-center shadow-card',
        tier.card,
        PLACES[place],
      )}
    >
      <span
        className={cn(
          'absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-4 py-1 text-sm font-black shadow-card',
          tier.badge,
        )}
      >
        <span aria-hidden="true">{m.rankNo(rank)}</span>
        <span className="sr-only">{m.podium.rank(rank)}</span>
      </span>
      <Avatar name={row.name} size="lg" className={cn('ring-4', tier.ring)} />
      <div className="mt-auto w-full pt-5">
        <p className={cn('break-words font-black text-ink', first ? 'text-xl' : 'text-lg')}>
          {row.name}
        </p>
        <p className="mt-1 break-all text-xs text-ink-muted">{row.email}</p>
        {row.institution ? (
          <p className="mt-1 text-xs font-semibold text-secondary">{row.institution}</p>
        ) : null}
        {row.category || row.entryStatus ? (
          <dl className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {row.category ? (
              <div>
                <dt className="sr-only">{m.table.category}</dt>
                <dd>
                  <Badge tone="brand">{c.categories[row.category]}</Badge>
                </dd>
              </div>
            ) : null}
            {row.entryStatus ? (
              <div>
                <dt className="sr-only">{m.table.status}</dt>
                <dd>
                  <Badge tone={entryStatusTone[row.entryStatus]}>
                    {c.entryStatus[row.entryStatus]}
                  </Badge>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {row.score !== null ? (
          <p className="mt-4 inline-flex rounded-full bg-shell px-5 py-1.5 text-base font-black text-white">
            {m.points(formatNumber(locale, row.score))}
          </p>
        ) : null}
        {row.timeTakenSeconds !== null ? (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-ink-muted">
            <Clock size={14} aria-hidden="true" />
            <span className="sr-only">{m.podium.timeTaken}</span>
            {formatDuration(locale, row.timeTakenSeconds)}
          </p>
        ) : null}
      </div>
    </li>
  );
}
