'use client';
import { createContext, useContext } from 'react';
import type { Locale } from '@/i18n';
import { common, type CommonMessages } from '@/i18n/common';

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

const FALLBACK: ClientI18n = { locale: 'en', states: common.en.states };

/** Falls back to English outside a provider: an error boundary must never throw itself. */
export function useClientI18n(): ClientI18n {
  return useContext(I18nContext) ?? FALLBACK;
}
