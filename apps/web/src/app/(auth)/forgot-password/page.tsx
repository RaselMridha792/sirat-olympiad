import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { authMessages } from '@/i18n/messages/auth';
import { getMessages } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(authMessages);
  return { title: m.forgot.title };
}

export default async function ForgotPasswordPage() {
  // The answer is identical whether or not the email exists (no account enumeration).
  const { locale } = await getMessages(authMessages);
  return <ForgotPasswordForm locale={locale} />;
}
