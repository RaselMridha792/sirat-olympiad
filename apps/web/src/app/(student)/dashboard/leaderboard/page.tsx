import type { Metadata } from 'next';
import { DataTable, PageHeader, EmptyState } from '@sirat/ui';
import { getData } from '@/data';
import { first, parsePageQuery, type SearchParams } from '@/data/query';

export const metadata: Metadata = { title: 'Leaderboard' };

// Interim: reads the data layer (server-paged snapshot). The full port (round tabs, search,
// pagination, i18n) replaces this page.
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const data = await getData(params);
  const view = await data.leaderboard.get({
    ...parsePageQuery(params),
    roundId: first(params.round),
  });
  return (
    <>
      <PageHeader
        title="Leaderboard"
        subtitle="Official results. Updated after the exam window closes."
      />
      {view.status === 'unpublished' || view.items.length === 0 ? (
        <EmptyState
          title="No results yet"
          description="Results are published after the window closes."
        />
      ) : (
        <DataTable
          rows={view.items}
          rowKey={(r) => `${r.rank}-${r.name}`}
          columns={[
            {
              key: 'rank',
              header: 'Rank',
              render: (r) => <span className="font-black text-ink-muted">#{r.rank}</span>,
            },
            {
              key: 'name',
              header: 'Name',
              render: (r) => <span className="font-bold">{r.name}</span>,
            },
            { key: 'inst', header: 'Institution', render: (r) => r.institution ?? '—' },
          ]}
        />
      )}
    </>
  );
}
