import { LegalPageView, publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('terms', 'en');

export default function Page() {
  return <LegalPageView page="terms" locale="en" />;
}
