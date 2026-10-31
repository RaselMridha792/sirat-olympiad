import { LegalPageView, publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('terms', 'bn');

export default function Page() {
  return <LegalPageView page="terms" locale="bn" />;
}
