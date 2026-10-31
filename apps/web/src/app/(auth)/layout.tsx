import { AuthSplitLayout } from '@sirat/ui';
import { authMessages } from '@/i18n/messages/auth';
import { getMessages } from '@/i18n/server';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { locale, m } = await getMessages(authMessages);
  return (
    <div lang={locale}>
      <AuthSplitLayout brand={m.brand} tagline={m.tagline}>
        {children}
      </AuthSplitLayout>
    </div>
  );
}
