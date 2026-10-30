import en from './en.json';
import bn from './bn.json';

export type Locale = 'en' | 'bn';
export const messages = { en, bn } as const;

/** Tiny dictionary lookup, e.g. t('en', 'login.title'). Replace with next-intl if routing by locale is needed. */
export function t(locale: Locale, key: string): string {
  const value = key.split('.').reduce<unknown>((acc, part) => {
    return acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined;
  }, messages[locale]);
  return typeof value === 'string' ? value : key;
}
