import { Hourglass } from 'lucide-react';
import { ComingSoon, PageHeader } from '@sirat/ui';
import { launchMessages } from '@/i18n/messages/launch';
import { getMessages } from '@/i18n/server';

/**
 * The whole page for a route the launch table marks `soon` (data/launch.ts): its own title, then "coming soon".
 * Use after requireAccess() and before any data call:
 *   if (!isLive('/admin/x', data, params.mock)) return <ComingSoonPage title={m.title} />;
 */
export async function ComingSoonPage({ title }: { title: string }) {
  const { m } = await getMessages(launchMessages);
  return (
    <>
      <PageHeader title={title} />
      <ComingSoon title={m.title} message={m.message} icon={<Hourglass size={26} />} />
    </>
  );
}
