import { LegalPageView, publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('privacy', 'en');

export default function Page() {
  return <LegalPageView page="privacy" locale="en" />;
}
