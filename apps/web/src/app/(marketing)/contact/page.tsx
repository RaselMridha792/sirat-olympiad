import { ContactPage } from '@/components/public/home/info-pages';
import { publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('contact', 'bn');

export default function Page() {
  return <ContactPage locale="bn" />;
}
