import { cookies, headers } from 'next/headers';
import type { Locale } from './index';
import { isLocale, LOCALE_COOKIE, negotiateLocale } from './config';
import { pick } from './messages';

/** Request locale for Server Components (makes the route dynamic, which dashboards are anyway). */
export async function getLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return negotiateLocale((await headers()).get('accept-language'));
}

/** `const { locale, m } = await getMessages(homeMessages)` */
export async function getMessages<M extends { en: unknown; bn: unknown }>(
  messages: M,
): Promise<{ locale: Locale; m: M['en'] }> {
  const locale = await getLocale();
  return { locale, m: pick(messages, locale) };
}
