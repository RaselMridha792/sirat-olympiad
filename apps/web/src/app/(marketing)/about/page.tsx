import { LegalPageView, publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('about', 'en');

export default function Page() {
  return <LegalPageView page="about" locale="en" />;
}
