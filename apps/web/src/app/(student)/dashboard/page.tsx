import type { Metadata } from 'next';
import { Card, PageHeader, Badge } from '@sirat/ui';

export const metadata: Metadata = { title: 'Dashboard' };

export default function StudentDashboard() {
  return (
    <>
      <PageHeader
        title="Welcome back"
        subtitle="Your exam window, status and results at a glance."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-bold">Current exam</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Window opens and closes are set by the server.
          </p>
          <div className="mt-3">
            <Badge tone="info">Waiting room</Badge>
          </div>
        </Card>
        <Card>
          <h2 className="font-bold">Rules</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Max 30 minutes. One attempt. The timer never resets.
          </p>
        </Card>
      </div>
    </>
  );
}
