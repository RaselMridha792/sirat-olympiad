import { PrizesPage } from '@/components/public/home/info-pages';
import { publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('prizes', 'bn');

export default function Page() {
  return <PrizesPage locale="bn" />;
}
