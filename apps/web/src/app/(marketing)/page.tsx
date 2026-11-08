import { HomePage } from '@/components/public/home/HomePage';
import { publicMetadata } from '@/components/public/pages';

export const revalidate = 60;
export const metadata = publicMetadata('home', 'bn');

export default function Page() {
  return <HomePage locale="bn" />;
}
