import type { Metadata } from 'next';
import { LoginForm } from '@/components/LoginForm';
import { authMessages } from '@/i18n/messages/auth';
import { getMessages } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(authMessages);
  return { title: m.login.title };
}

export default async function LoginPage() {
  const { locale } = await getMessages(authMessages);
  return <LoginForm locale={locale} />;
}
