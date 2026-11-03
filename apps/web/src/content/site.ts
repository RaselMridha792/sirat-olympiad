/**
 * The public site's facts, in ONE place (RULEBOOK §18: content, dates and contact details come from one source).
 * PayStation's merchant review asks for a live site with an about page, terms, a privacy policy, contact details
 * (one email and at least one phone number) and the registered business name (core plan Q5). The client sends the
 * real values; until then they are null and the pages say so. Texts live in i18n/messages/legal.ts.
 */
export interface SiteFacts {
  /** The programme's public name. */
  name: string;
  /** Who runs it, as the client wants it shown. */
  organiser: string;
  /** The registered business name PayStation's review checks (from the client). */
  registeredName: string | null;
  address: string | null;
  email: string | null;
  /** In the form the client gives it, e.g. +880 1XXX-XXXXXX. */
  phone: string | null;
  /** ISO date the legal texts take effect (from the client). */
  effectiveDate: string | null;
  /**
   * True while any legal text or fact is our placeholder: the pages carry `noindex` and a visible draft note.
   * Set to false only with the client's final texts and facts in place.
   */
  placeholder: boolean;
}

export const site: SiteFacts = {
  name: 'Sirat Leadership Olympiad',
  organiser: 'GLTS Leadership × Sirat Olympiad',
  registeredName: null,
  address: null,
  email: null,
  phone: null,
  effectiveDate: null,
  placeholder: true,
};

/** The public pages, Bangla at the root and English under /en (core plan D4, owner 2026-11-03). */
export const PUBLIC_PAGES = ['home', 'about', 'privacy', 'terms', 'refund'] as const;
export type PublicPage = (typeof PUBLIC_PAGES)[number];

const PATHS: Record<PublicPage, string> = {
  home: '/',
  about: '/about',
  privacy: '/privacy',
  terms: '/terms',
  refund: '/refund-policy',
};

export function publicPath(page: PublicPage, locale: 'en' | 'bn'): string {
  const path = PATHS[page];
  if (locale === 'bn') return path;
  return path === '/' ? '/en' : `/en${path}`;
}
