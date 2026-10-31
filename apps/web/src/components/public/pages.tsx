import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClasses, Card, Prose } from '@sirat/ui';
import { publicPath, site, type PublicPage } from '@/content/site';
import type { Locale } from '@/i18n';
import { formatDate, formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { legalMessages } from '@/i18n/messages/legal';
import { getRegistrationInfo } from '@/lib/public-api';
import { PublicShell } from './PublicShell';

/*
 * The public entry page and the legal pages (core plan section 3). Each route file is two lines that pick a page and
 * a locale, so English (/) and Bangla (/bn) never drift apart. Static: no cookie or header is read.
 */

type LegalPage = Exclude<PublicPage, 'home'>;

/** Title, description, hreflang alternates, and noindex while any text is a placeholder. */
export function publicMetadata(page: PublicPage, locale: Locale): Metadata {
  const m = pick(legalMessages, locale);
  const { title, metaDescription } = page === 'home' ? m.home : m[page];
  return {
    title: page === 'home' ? { absolute: title } : title,
    description: metaDescription,
    alternates: {
      canonical: publicPath(page, locale),
      languages: { en: publicPath(page, 'en'), bn: publicPath(page, 'bn') },
    },
    robots: site.placeholder ? { index: false, follow: true } : undefined,
  };
}

export async function EntryPage({ locale }: { locale: Locale }) {
  const m = pick(legalMessages, locale);
  const info = await getRegistrationInfo();
  return (
    <PublicShell locale={locale} page="home">
      <section className="rounded-card bg-shell px-6 py-14 text-center text-white md:py-20">
        <h1 className="text-3xl font-extrabold md:text-5xl">{m.home.title}</h1>
        <p className="mx-auto mt-4 max-w-xl text-white/80">{m.home.tagline}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/register" className={buttonClasses({ size: 'lg' })}>
            {m.nav.register}
          </Link>
          <Link
            href="/login"
            className="rounded-control border border-white/30 px-6 py-3 font-semibold hover:bg-white/10"
          >
            {m.nav.login}
          </Link>
        </div>
        <p className="mt-6 text-sm text-white/80">
          {info ? (info.open ? m.home.open : m.home.closed) : null}{' '}
          {info?.fee
            ? m.home.fee(`${formatNumber(locale, info.fee.amountMinor / 100)} ${info.fee.currency}`)
            : m.home.feeUnknown}
        </p>
      </section>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Card>
          <p className="leading-relaxed text-ink-muted">{m.home.intro}</p>
        </Card>
        <Card>
          <h2 className="text-lg font-bold">{m.home.stepsTitle}</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-ink-muted">
            {m.home.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Card>
      </div>
    </PublicShell>
  );
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
