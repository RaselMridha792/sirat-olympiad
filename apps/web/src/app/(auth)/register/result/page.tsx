import type { Metadata } from 'next';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { PaymentResult } from '@/components/registration/PaymentResult';
import { registrationMessages } from '@/i18n/messages/registration';
import { getMessages } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(registrationMessages);
  return { title: m.result.metaTitle };
}

/**
 * The payment result page: PayStation's callback lands on the API, which answers 303 to here (APP_URL +
 * /register/result) with nothing in the URL. Everything shown comes from GET /registrations/current in the browser.
 */
export default async function RegisterResultPage() {
  const { locale } = await getMessages(registrationMessages);
  return (
    <>
      <div className="mb-6 flex justify-end">
        <LanguageSwitch />
      </div>
      <PaymentResult locale={locale} />
    </>
  );
}
