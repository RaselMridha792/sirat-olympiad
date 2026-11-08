/**
 * The public site's facts, in ONE place (RULEBOOK §18: content, dates and contact details come from one source).
 * PayStation's merchant review asks for a live site with an about page, terms, a privacy policy, contact details
 * (one email and at least one phone number) and the registered business name (core plan Q5). The client sends the
 * real values; until then they are null and the pages say so. Texts live in i18n/messages/legal.ts.
 */
export interface SiteFacts {
  /**
   * The programme's public name, per language: the ONE source (lead, 2026-11-03). The homepage, the shell, the page
   * titles and the legal texts read it. To confirm with the client (the old site says সিরাত অলিম্পিয়াড ২০২৬).
   */
  name: { bn: string; en: string };
  /** The season's line under the name, the same in both languages. */
  season: string;
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
  name: { bn: 'ইন্টারন্যাশনাল সিরাত অলিম্পিয়াড ৩.০', en: 'International Sirat Olympiad 3.0' },
  season: 'Prophetic Leadership Season',
  organiser: 'GLTS Leadership × Sirat Olympiad',
  registeredName: null,
  address: null,
  // To confirm: the client's PDF gives this address; the old site shows bangladeshsiratolympiad@gmail.com and the
  // phone +880 1805-205761. The client decides (lead, 2026-11-03); registeredName, address and phone stay null.
  email: 'internationalsiratolympiad@gmail.com',
  phone: null,
  effectiveDate: null,
  placeholder: true,
};

/**
 * The public pages, Bangla at the root and English under /en (core plan D4, owner 2026-11-03). The site is
 * multi-page (owner, 2026-11-08): the homepage gives an overview and each topic has its own page.
 */
export const PUBLIC_PAGES = [
  'home',
  'about',
  'participate',
  'rounds',
  'prizes',
  'syllabus',
  'ambassador',
  'gallery',
  'faq',
  'contact',
  'privacy',
  'terms',
  'refund',
] as const;
export type PublicPage = (typeof PUBLIC_PAGES)[number];

const PATHS: Record<PublicPage, string> = {
  home: '/',
  about: '/about',
  participate: '/how-to-take-part',
  rounds: '/rounds',
  prizes: '/prizes',
  syllabus: '/syllabus',
  ambassador: '/ambassador',
  gallery: '/gallery',
  faq: '/faq',
  contact: '/contact',
  privacy: '/privacy',
  terms: '/terms',
  refund: '/refund-policy',
};

/** The header's main menu and the footer's site map, in this order (the homepage is the brand link). */
export const MENU_PAGES = [
  'about',
  'participate',
  'rounds',
  'prizes',
  'syllabus',
  'ambassador',
  'gallery',
  'faq',
  'contact',
] as const satisfies readonly PublicPage[];
export type MenuPage = (typeof MENU_PAGES)[number];

/** The policy pages: the footer only. */
export const POLICY_PAGES = ['privacy', 'terms', 'refund'] as const satisfies readonly PublicPage[];

export function publicPath(page: PublicPage, locale: 'en' | 'bn'): string {
  const path = PATHS[page];
  if (locale === 'bn') return path;
  return path === '/' ? '/en' : `/en${path}`;
}
