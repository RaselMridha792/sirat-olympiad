import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { authMessages } from '@/i18n/messages/auth';
import { getMessages } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(authMessages);
  return { title: m.reset.title, robots: { index: false } };
}

/** Opened from the reset email: `/reset-password#token=...` (the token stays in the browser). */
export default async function ResetPasswordPage() {
  const { locale } = await getMessages(authMessages);
  return <ResetPasswordForm locale={locale} />;
}
