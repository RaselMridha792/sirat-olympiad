import type { Metadata } from 'next';
import { Users, CheckCircle, Wallet, Activity } from 'lucide-react';
import { PageHeader, StatCard, Card } from '@sirat/ui';

export const metadata: Metadata = { title: 'Admin Dashboard' };

// KPIs come from cached aggregates (Redis, refreshed by a job) — never full-table scans per request.
export default function AdminHome() {
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Registrations, payments and live exam activity." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Registered" value="—" icon={<Users size={26} />} />
        <StatCard title="Paid" value="—" icon={<Wallet size={26} />} />
        <StatCard title="Active attempts" value="—" icon={<Activity size={26} />} />
        <StatCard title="Submitted" value="—" icon={<CheckCircle size={26} />} />
      </div>
      <Card className="mt-6 text-sm text-ink-muted">Charts (registrations trend, by category) go here.</Card>
    </>
  );
}
