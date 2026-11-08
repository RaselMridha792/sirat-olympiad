import { GalleryPage } from '@/components/public/home/info-pages';
import { publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('gallery', 'bn');

export default function Page() {
  return <GalleryPage locale="bn" />;
}
