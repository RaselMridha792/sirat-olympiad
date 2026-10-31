import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, CloudOff } from 'lucide-react';
import { buttonClasses } from '@sirat/ui';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { readRegistrationPage } from '@/components/registration/registration-info';
import { RegisterWizard } from '@/components/registration/RegisterWizard';
import { RegistrationNotice } from '@/components/registration/RegistrationNotice';
import { formatDateTime } from '@/i18n/format';
import { registrationMessages } from '@/i18n/messages/registration';
import { getMessages } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(registrationMessages);
  return { title: m.metaTitle };
}

/**
 * Registration (old registration-full). Open or closed, the fee and the form's choices come from the API
 * (GET /registrations/info, cached 30 s): `open` is false while the switch is off, outside the window, while the fee
 * is invalid or while PayStation is not configured. The wizard itself talks to the API from the browser.
 */
export default async function RegisterPage() {
  const [{ locale, m }, { info, opensAt }] = await Promise.all([
    getMessages(registrationMessages),
    readRegistrationPage(),
  ]);
  const login = (
    <Link href="/login" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
      {m.login}
    </Link>
  );

  let body: React.ReactNode;
  if (!info) {
    body = (
      <RegistrationNotice
        icon={<CloudOff size={26} />}
        title={m.unavailable.title}
        text={m.unavailable.text}
      >
        {login}
      </RegistrationNotice>
    );
  } else if (!info.open || !info.fee) {
    body = (
      <RegistrationNotice
        icon={<CalendarClock size={26} />}
        title={m.closed.title}
        text={opensAt ? m.closed.opensAt(formatDateTime(locale, opensAt)) : m.closed.text}
      >
        {login}
      </RegistrationNotice>
    );
  } else {
    body = (
      <RegisterWizard
        locale={locale}
        info={{
          fee: info.fee,
          gradeLevels: info.gradeLevels,
          districts: info.districts,
          educationTypes: info.educationTypes,
        }}
      />
    );
  }

  return (
    <>
      <div className="mb-6 flex justify-end">
        <LanguageSwitch />
      </div>
      {body}
    </>
  );
}
