import { EntryPage, publicMetadata } from '@/components/public/pages';

// Static, re-rendered at most every 60 s for the fee and the open state (lib/public-api.ts).
export const revalidate = 60;
export const metadata = publicMetadata('home', 'bn');

export default function Page() {
  return <EntryPage locale="bn" />;
}
