'use server';
import { cookies } from 'next/headers';
import { isLocale, LOCALE_COOKIE } from './config';

/**
 * Language switch. A UI preference, not a credential, but it is still httpOnly so no script can
 * read cookies at all (RULEBOOK §18). Setting a cookie in a Server Action re-renders the page.
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const value = formData.get('locale');
  if (!isLocale(value)) return;
  (await cookies()).set(LOCALE_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
