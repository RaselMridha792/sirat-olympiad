import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@sirat/ui';
import { ExamRoom } from '@/components/exam/ExamRoom';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import { studentExamsMessages } from '@/i18n/messages/student-exams';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

/*
 * One exam: the waiting room, the player and the receipt (old app/quiz/page.jsx). The server read is only the
 * waiting-room detail (never questions); the questions come to the browser from POST /exams/:id/attempts after the
 * student accepts the rules, and every answer stays in the browser until a checkpoint or the submit.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(studentExamsMessages);
  return { title: m.title };
}

export default async function ExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/dashboard/exam');
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [{ locale }, data] = await Promise.all([getMessages(studentExamsMessages), getData(query)]);
  const exam = await data.student.getExam(id);
  if (!exam) notFound();
  return (
    <>
      <PageHeader title={exam.title} />
      <ExamRoom locale={locale} exam={exam} />
    </>
  );
}
