import { LegalPageView, publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('about', 'bn');

export default function Page() {
  return <LegalPageView page="about" locale="bn" />;
}
