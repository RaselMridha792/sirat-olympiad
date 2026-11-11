import type { Metadata } from 'next';
import { ForgotIdForm } from '@/components/auth/ForgotPasswordForm';
import { authMessages } from '@/i18n/messages/auth';
import { getMessages } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(authMessages);
  return { title: m.forgotId.title };
}

export default async function ForgotIdPage() {
  // The answer is identical whether or not the email belongs to a registered student (no account enumeration).
  const { locale } = await getMessages(authMessages);
  return <ForgotIdForm locale={locale} />;
}
