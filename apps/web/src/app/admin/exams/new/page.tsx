import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@sirat/ui';
import { ExamSettingsForm } from '@/components/exam/admin/ExamSettingsForm';
import { common } from '@/i18n/common';
import { adminExamAuthoringMessages } from '@/i18n/messages/admin-exam-authoring';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminExamAuthoringMessages);
  return { title: m.form.newTitle };
}

/** A new exam (E5b): the settings form; it saves a draft and opens its page, where the questions are added. */
export default async function NewExamPage() {
  await requireAccess('/admin/exams/new');
  const [{ locale, m }, { m: c }] = await Promise.all([
    getMessages(adminExamAuthoringMessages),
    getMessages(common),
  ]);
  return (
    <>
      <Link
        href="/admin/exams"
        className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-secondary underline-offset-4 hover:underline"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {m.form.backToList}
      </Link>
      <PageHeader title={m.form.newTitle} subtitle={m.form.newSubtitle} />
      <div className="max-w-3xl">
        <ExamSettingsForm locale={locale} categoryLabels={c.categories} />
      </div>
    </>
  );
}
