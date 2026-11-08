import { ParticipatePage } from '@/components/public/home/info-pages';
import { publicMetadata } from '@/components/public/pages';

export const revalidate = 60;
export const metadata = publicMetadata('participate', 'bn');

export default function Page() {
  return <ParticipatePage locale="bn" />;
}
