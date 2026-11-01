import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@sirat/ui';
import { pickSettings } from '@/components/exam/admin/exam-authoring';
import { ExamSettingsForm } from '@/components/exam/admin/ExamSettingsForm';
import { getData } from '@/data';
import { parseId, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { adminExamAuthoringMessages } from '@/i18n/messages/admin-exam-authoring';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminExamAuthoringMessages);
  return { title: m.form.editTitle };
}

/**
 * An exam's settings (E5b). The form gets the settings only (no questions, so no answer keys), with `updatedAt` as
 * the version its save sends back. What a state lets change is the form's and the server's business.
 */
export default async function EditExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/admin/exams/[id]/edit');
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const examId = parseId(id);
  if (!examId) notFound();
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminExamAuthoringMessages),
    getMessages(common),
    getData(query),
  ]);
  const exam = await data.admin.getExam(examId);
  if (!exam) notFound();
  return (
    <>
      <Link
        href={`/admin/exams/${encodeURIComponent(exam.id)}`}
        className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-secondary underline-offset-4 hover:underline"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {m.form.back}
      </Link>
      <PageHeader title={m.form.editTitle} subtitle={m.form.editSubtitle(exam.title)} />
      <div className="max-w-3xl">
        <ExamSettingsForm locale={locale} categoryLabels={c.categories} exam={pickSettings(exam)} />
      </div>
    </>
  );
}
