import { LegalPageView, publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('refund', 'bn');

export default function Page() {
  return <LegalPageView page="refund" locale="bn" />;
}
