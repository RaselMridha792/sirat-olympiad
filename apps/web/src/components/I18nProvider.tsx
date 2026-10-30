'use client';
import { createContext, useContext } from 'react';
import type { Locale } from '@/i18n';
import type { CommonMessages } from '@/i18n/common';

/** What client components (error boundaries, dialogs) need: plain strings only, no functions. */
export interface ClientI18n {
  locale: Locale;
  states: CommonMessages['states'];
}

const I18nContext = createContext<ClientI18n | null>(null);

/** Placed by the dashboard layouts, so segment error.tsx files below them can speak the user's language. */
export function I18nProvider({
  value,
  children,
}: {
  value: ClientI18n;
  children: React.ReactNode;
}) {
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useClientI18n(): ClientI18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useClientI18n must be used inside <I18nProvider>');
  return value;
}
