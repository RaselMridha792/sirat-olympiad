import { AmbassadorPage } from '@/components/public/home/info-pages';
import { publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('ambassador', 'en');

export default function Page() {
  return <AmbassadorPage locale="en" />;
}
