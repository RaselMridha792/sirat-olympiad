import type { Locale } from './index';

/**
 * Locale rules for the dashboards. Pure (no Next imports) so `node --test` can cover it.
 * Order: the `locale` cookie (set by the language switch) -> the browser's Accept-Language -> DEFAULT_LOCALE.
 */
export const LOCALES: readonly Locale[] = ['en', 'bn'];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'locale';
export const TIME_ZONE = 'Asia/Dhaka';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Picks the supported language with the highest q-value from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  let best: { locale: Locale; q: number } | null = null;
  for (const part of acceptLanguage.split(',')) {
    const [tag = '', ...params] = part.trim().split(';');
    const primary = tag.trim().toLowerCase().split('-')[0];
    if (!isLocale(primary)) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (!Number.isFinite(q) || q <= 0) continue;
    if (!best || q > best.q) best = { locale: primary, q };
  }
  return best?.locale ?? DEFAULT_LOCALE;
}

/** BCP 47 tag for Intl formatting. bn-BD formats with Bangla digits. */
export function intlTag(locale: Locale): string {
  return locale === 'bn' ? 'bn-BD' : 'en-GB';
}
