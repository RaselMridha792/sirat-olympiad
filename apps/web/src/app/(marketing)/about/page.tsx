import { AboutPage } from '@/components/public/home/AboutPage';
import { publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('about', 'bn');

export default function Page() {
  return <AboutPage locale="bn" />;
}
