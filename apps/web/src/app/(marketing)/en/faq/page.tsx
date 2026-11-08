import { FaqPage } from '@/components/public/home/info-pages';
import { publicMetadata } from '@/components/public/pages';

export const revalidate = 60;
export const metadata = publicMetadata('faq', 'en');

export default function Page() {
  return <FaqPage locale="en" />;
}
