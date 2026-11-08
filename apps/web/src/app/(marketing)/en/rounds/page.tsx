import { RoundsPage } from '@/components/public/home/info-pages';
import { publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('rounds', 'en');

export default function Page() {
  return <RoundsPage locale="en" />;
}
