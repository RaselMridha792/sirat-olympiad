import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClasses, cn, SkipLink, StarMark, WithHonorific } from '@sirat/ui';
import { publicPath, site, type PublicPage } from '@/content/site';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { homeMessages } from '@/i18n/messages/home';
import { legalMessages } from '@/i18n/messages/legal';

const yearIn = (locale: Locale, year: number) =>
  new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', { useGrouping: false }).format(year);

/**
 * Frame of every public page: the brand (one key, homeMessages.brand), the language link, log in and register; the
 * footer with the legal links, the contact details and the registered name from content/site.ts (PayStation's
 * merchant review reads them). Static: the locale comes from the route (Bangla at /, English under /en), never from
 * a cookie. The wrapper sets `lang`; the root <html lang> stays "en" until Phase D (DECISIONS UI port #16).
 * `bleed` lets a long page (home, about) run its bands edge to edge; other pages get the reading column.
 */
export function PublicShell({
  locale,
  page,
  bleed = false,
  children,
}: {
  locale: Locale;
  page: PublicPage;
  bleed?: boolean;
  children: ReactNode;
}) {
  const m = pick(legalMessages, locale);
  const home = pick(homeMessages, locale);
  const other: Locale = locale === 'en' ? 'bn' : 'en';
  const seasonLang = locale === 'bn' ? 'en' : undefined;
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
  const draftNote = site.placeholder ? m.draftNote : null;

  return (
    <div
      lang={locale}
      className={cn(
        'flex min-h-screen flex-col bg-page text-ink',
        locale === 'bn' && 'leading-[1.7]',
      )}
    >
      <SkipLink>{home.shell.skip}</SkipLink>
      <header className="bg-shell text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3.5 sm:px-6">
          <Link href={publicPath('home', locale)} className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary-strong text-white"
            >
              <StarMark className="h-6 w-6" />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-base font-extrabold sm:text-lg">{home.brand.name}</span>
              <span lang={seasonLang} className="text-xs font-medium text-white/70">
                {home.brand.season}
              </span>
            </span>
          </Link>
          <nav aria-label={m.nav.label} className="flex flex-wrap items-center gap-2">
            <Link
              href={publicPath(page, other)}
              hrefLang={other}
              lang={other}
              aria-label={m.nav.otherLanguageLabel}
              className={cn(
                'rounded-control px-3 py-2 text-sm font-semibold hover:bg-white/10',
                // A language's own name in the system font: the web font would load the whole Bangla font here.
                other === 'bn' && 'font-system',
              )}
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

      {bleed ? (
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {draftNote ? (
            <p
              role="note"
              className="border-b border-line bg-warning-soft px-4 py-2 text-center text-sm text-warning-strong"
            >
              {draftNote}
            </p>
          ) : null}
          {children}
        </main>
      ) : (
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 outline-none"
        >
          {draftNote ? (
            <p
              role="note"
              className="mb-6 rounded-control border border-line bg-surface px-4 py-3 text-sm text-ink-muted"
            >
              {draftNote}
            </p>
          ) : null}
          {children}
        </main>
      )}

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="flex items-center gap-2 text-base font-extrabold text-ink">
              <StarMark className="h-4 w-4 text-primary-strong" />
              {home.brand.name}
            </p>
            <p lang={seasonLang} className="mt-1 font-medium text-ink-muted">
              {home.brand.season}
            </p>
            <p className="mt-3 max-w-sm leading-relaxed text-ink-muted">
              <WithHonorific text={home.hero.tagline} honorific={home.brand.honorific} />
            </p>
          </div>
          <nav aria-label={home.shell.footerNav}>
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
                    <dd className="break-all">{item.value}</dd>
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
