import { LegalPageView, publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('refund', 'en');

export default function Page() {
  return <LegalPageView page="refund" locale="en" />;
}
