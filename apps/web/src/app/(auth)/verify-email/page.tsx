import type { Metadata } from 'next';
import { VerifyEmailForm } from '@/components/auth/VerifyEmailForm';
import { authMessages } from '@/i18n/messages/auth';
import { getMessages } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(authMessages);
  return { title: m.verify.title, robots: { index: false } };
}

/** Opened from the verification email: `/verify-email#token=...` (the token stays in the browser). */
export default async function VerifyEmailPage() {
  const { locale } = await getMessages(authMessages);
  return <VerifyEmailForm locale={locale} />;
}
