import type { Metadata } from 'next';
import { PageHeader, StatCard, EmptyState } from '@sirat/ui';

export const metadata: Metadata = { title: 'Ambassador Panel' };

export default function AmbassadorPage() {
  return (
    <>
      <PageHeader title="Ambassador Panel" subtitle="Points, rank, team and assigned tasks." />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Points" value={0} hint="Derived from the ledger" />
        <StatCard title="Rank" value="Bronze" hint="Thresholds come from a config table" />
        <StatCard title="Referrals" value={0} hint="Counted from real rows" />
      </div>
      <div className="mt-6"><EmptyState title="No tasks assigned yet" /></div>
    </>
  );
}
