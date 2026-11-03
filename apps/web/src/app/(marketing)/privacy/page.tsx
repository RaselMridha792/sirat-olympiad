import { LegalPageView, publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('privacy', 'bn');

export default function Page() {
  return <LegalPageView page="privacy" locale="bn" />;
}
