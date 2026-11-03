import type { Metadata } from 'next';
import { Prose } from '@sirat/ui';
import { publicPath, site, type PublicPage } from '@/content/site';
import type { Locale } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { aboutMessages } from '@/i18n/messages/about';
import { homeMessages } from '@/i18n/messages/home';
import { legalMessages } from '@/i18n/messages/legal';
import { withHonorificText } from './home/home-view';
import { PublicShell } from './PublicShell';

/*
 * The public pages (core plan section 3). Each route file is two lines that pick a page and a locale, so Bangla (/)
 * and English (/en) never drift apart. Static: no cookie or header is read. The homepage and About are in
 * components/public/home/; the policy pages render their texts from i18n/messages/legal.ts here.
 */

type LegalPage = Exclude<PublicPage, 'home' | 'about'>;

/** Title, description, hreflang alternates, and noindex while any text is a placeholder. */
export function publicMetadata(page: PublicPage, locale: Locale): Metadata {
  const home = pick(homeMessages, locale);
  const { name, season, honorific } = home.brand;
  const { title, description } =
    page === 'home'
      ? {
          title: `${name} | ${season}`,
          description: withHonorificText(home.metaDescription, honorific),
        }
      : page === 'about'
        ? {
            title: `${pick(aboutMessages, locale).title} | ${name}`,
            description: pick(aboutMessages, locale).metaDescription,
          }
        : {
            title: `${pick(legalMessages, locale)[page].title} | ${name}`,
            description: pick(legalMessages, locale)[page].metaDescription,
          };
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: publicPath(page, locale),
      languages: { bn: publicPath(page, 'bn'), en: publicPath(page, 'en') },
    },
    robots: site.placeholder ? { index: false, follow: true } : undefined,
  };
}

export function LegalPageView({ page, locale }: { page: LegalPage; locale: Locale }) {
  const m = pick(legalMessages, locale);
  const content = m[page];
  return (
    <PublicShell locale={locale} page={page}>
      <article className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{content.title}</h1>
        {site.effectiveDate ? (
          <p className="mt-2 text-sm text-ink-muted">
            {m.effective(formatDate(locale, site.effectiveDate))}
          </p>
        ) : null}
        <Prose sections={content.sections} className="mt-8" />
      </article>
    </PublicShell>
  );
}
