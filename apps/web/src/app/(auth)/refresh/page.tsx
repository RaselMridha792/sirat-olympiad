import type { Metadata } from 'next';
import { RefreshScreen } from '@/components/auth/RefreshScreen';
import { authMessages } from '@/i18n/messages/auth';
import { getMessages } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(authMessages);
  return { title: m.refresh.title, robots: { index: false } };
}

/** Not under the dashboard proxy (src/proxy.ts), so it can never send a user back here in a loop. */
export default async function RefreshPage() {
  const { locale } = await getMessages(authMessages);
  return <RefreshScreen locale={locale} />;
}
