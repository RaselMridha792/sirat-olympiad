import { SyllabusPage } from '@/components/public/home/info-pages';
import { publicMetadata } from '@/components/public/pages';

export const metadata = publicMetadata('syllabus', 'bn');

export default function Page() {
  return <SyllabusPage locale="bn" />;
}
