import { SyllabusPage } from '@/components/public/home/info-pages';
import { publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('syllabus', 'en');

export default function Page() {
  return <SyllabusPage locale="en" />;
}
