import type { Metadata } from 'next';
import { DataTable, PageHeader, EmptyState, Badge } from '@sirat/ui';
import { mockLeaderboard } from '@/lib/mock';

export const metadata: Metadata = { title: 'Leaderboard' };

// Real version: server-side pagination + search, data from a precomputed Redis/CDN snapshot,
// published only after the window closes. Old page loaded 4000 rows into the browser — never do that.
export default function LeaderboardPage() {
  const rows = mockLeaderboard;
  return (
    <>
      <PageHeader title="Leaderboard" subtitle="Official results. Updated after the exam window closes." />
      {rows.length === 0 ? (
        <EmptyState title="No results yet" description="Results are published after the window closes." />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(r) => String(r.rank)}
          columns={[
            { key: 'rank', header: 'Rank', render: (r) => <span className="font-black text-ink-muted">#{r.rank}</span> },
            { key: 'name', header: 'Name', render: (r) => <span className="font-bold">{r.name}</span> },
            { key: 'inst', header: 'Institution', render: (r) => r.institution },
            { key: 'cat', header: 'Category', render: (r) => <Badge tone="brand">{r.category}</Badge> },
          ]}
        />
      )}
    </>
  );
}
