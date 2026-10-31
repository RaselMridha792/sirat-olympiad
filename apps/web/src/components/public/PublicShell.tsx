import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClasses } from '@sirat/ui';
import { publicPath, site, type PublicPage } from '@/content/site';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { legalMessages } from '@/i18n/messages/legal';

const yearIn = (locale: Locale, year: number) =>
  new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', { useGrouping: false }).format(year);

/**
 * Frame of every public page: brand, language link, log in and register; the footer with the legal links, the
 * contact details and the registered name from content/site.ts (PayStation's merchant review reads them). Static:
 * the locale comes from the route (/ or /bn), never from a cookie. Bangla pages set `lang` on their wrapper; the
 * root <html lang> stays "en" until Phase D (DECISIONS UI port #16).
 */
export function PublicShell({
  locale,
  page,
  children,
}: {
  locale: Locale;
  page: PublicPage;
  children: ReactNode;
}) {
  const m = pick(legalMessages, locale);
  const other: Locale = locale === 'en' ? 'bn' : 'en';
  const links: Array<{ page: Exclude<PublicPage, 'home'>; label: string }> = [
    { page: 'about', label: m.nav.about },
    { page: 'privacy', label: m.nav.privacy },
    { page: 'terms', label: m.nav.terms },
    { page: 'refund', label: m.nav.refund },
  ];
  const contact = [
    site.registeredName ? { label: m.footer.registeredName, value: site.registeredName } : null,
    site.address ? { label: m.footer.address, value: site.address } : null,
    site.email ? { label: m.footer.email, value: site.email } : null,
    site.phone ? { label: m.footer.phone, value: site.phone } : null,
  ].filter((item) => item !== null);

  return (
    <div lang={locale} className="flex min-h-screen flex-col bg-page text-ink">
      <header className="bg-shell text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <Link href={publicPath('home', locale)} className="text-lg font-extrabold tracking-tight">
            Sirat <span className="text-primary">Leadership</span> Olympiad
          </Link>
          <nav aria-label={m.nav.label} className="flex flex-wrap items-center gap-2">
            <Link
              href={publicPath(page, other)}
              hrefLang={other}
              lang={other}
              aria-label={m.nav.otherLanguageLabel}
              className="rounded-control px-3 py-2 text-sm font-semibold hover:bg-white/10"
            >
              {m.nav.otherLanguage}
            </Link>
            <Link
              href="/login"
              className="rounded-control border border-white/30 px-4 py-2 text-sm font-semibold hover:bg-white/10"
            >
              {m.nav.login}
            </Link>
            <Link href="/register" className={buttonClasses({ size: 'sm' })}>
              {m.nav.register}
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {site.placeholder ? (
          <p
            role="note"
            className="mb-6 rounded-control border border-line bg-surface px-4 py-3 text-sm text-ink-muted"
          >
            {m.draftNote}
          </p>
        ) : null}
        {children}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 py-8 text-sm md:grid-cols-2">
          <nav aria-label={m.nav.label}>
            <ul className="flex flex-col gap-2">
              {links.map((link) => (
                <li key={link.page}>
                  <Link
                    href={publicPath(link.page, locale)}
                    className="font-medium text-secondary underline-offset-4 hover:underline"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <h2 className="font-bold text-ink">{m.footer.contact}</h2>
            {contact.length ? (
              <dl className="mt-2 flex flex-col gap-1 text-ink-muted">
                {contact.map((item) => (
                  <div key={item.label} className="flex flex-wrap gap-x-2">
                    <dt className="font-semibold text-ink">{item.label}:</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-ink-muted">{m.footer.contactMissing}</p>
            )}
            <p className="mt-4 text-ink-muted">
              {m.footer.rights(yearIn(locale, new Date().getFullYear()), site.organiser)}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
