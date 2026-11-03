import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@sirat/ui';
import { ExamPreview } from '@/components/exam/admin/ExamPreview';
import { getData } from '@/data';
import { parseId, type SearchParams } from '@/data/query';
import { adminExamPreviewMessages } from '@/i18n/messages/admin-exam-preview';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminExamPreviewMessages);
  return { title: m.metaTitle };
}

/**
 * The admin exam preview (D2, P1): one sample draw from the server, shown with the student's question card. Admins
 * only (the /admin/exams row in lib/access.ts; the API refuses everyone else too). Nothing is written by opening it.
 */
export default async function AdminExamPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/admin/exams/[id]/preview');
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const examId = parseId(id);
  if (!examId) notFound();
  const [{ locale, m }, data] = await Promise.all([
    getMessages(adminExamPreviewMessages),
    getData(query),
  ]);
  const preview = await data.admin.getExamPreview(examId);
  if (!preview) notFound();
  // Keyed by the draw, so "Draw again" starts the new sample from its first question.
  const draw = preview.questions
    .map((q) => `${q.text}\u0000${q.options.join('\u0001')}`)
    .join('\u0002');
  return (
    <>
      <Link
        href={`/admin/exams/${encodeURIComponent(preview.examId)}`}
        className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-secondary underline-offset-4 hover:underline"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {m.back}
      </Link>
      <PageHeader title={preview.title} subtitle={m.metaTitle} />
      <div className="max-w-5xl">
        <ExamPreview key={draw} locale={locale} preview={preview} />
      </div>
    </>
  );
}
