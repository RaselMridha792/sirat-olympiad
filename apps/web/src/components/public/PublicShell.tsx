import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown, Menu } from 'lucide-react';
import Image from 'next/image';
import { buttonClasses, cn, SkipLink, WithHonorific } from '@sirat/ui';
import siratMark from './sirat-mark.png';
import { MENU_PAGES, POLICY_PAGES, publicPath, site, type PublicPage } from '@/content/site';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { homeMessages } from '@/i18n/messages/home';
import { legalMessages } from '@/i18n/messages/legal';
import { pagesMessages } from '@/i18n/messages/pages';

const yearIn = (locale: Locale, year: number) =>
  new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', { useGrouping: false }).format(year);

/**
 * Frame of every public page (the multi-page site, owner 2026-11-08):
 * - the header: the brand (one key, content/site.ts), the language link, log in and register; below them the main
 *   menu of the site's pages, a row from md up and a native <details> "Menu" on phones (works without JavaScript).
 *   The header stays at the top from md up;
 * - the footer: a site map (the pages, taking part, the policies), the contact details and the registered name
 *   from content/site.ts (PayStation's merchant review reads them).
 * Static: the locale comes from the route (Bangla at /, English under /en), never from a cookie. The wrapper sets
 * `lang`; the root <html lang> stays "en" until Phase D (DECISIONS UI port #16). `bleed` lets a long page run its
 * bands edge to edge; the policy pages get the reading column.
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
  const p = pick(pagesMessages, locale);
  const other: Locale = locale === 'en' ? 'bn' : 'en';
  const seasonLang = locale === 'bn' ? 'en' : undefined;
  const menu = MENU_PAGES.map((key) => ({
    key,
    href: publicPath(key, locale),
    label: p.menu[key],
    current: key === page,
  }));
  const policies = POLICY_PAGES.map((key) => ({
    key,
    href: publicPath(key, locale),
    label: m.nav[key],
  }));
  const contact = [
    site.registeredName ? { label: m.footer.registeredName, value: site.registeredName } : null,
    site.address ? { label: m.footer.address, value: site.address } : null,
    site.email ? { label: m.footer.email, value: site.email } : null,
    site.phone ? { label: m.footer.phone, value: site.phone } : null,
  ].filter((item) => item !== null);
  const draftNote = site.placeholder && site.showDraftNote ? m.draftNote : null;
  const footerLink =
    'inline-flex min-h-6 items-center font-medium text-secondary underline-offset-4 hover:underline';

  return (
    <div
      lang={locale}
      className={cn(
        'flex min-h-screen flex-col bg-page text-ink',
        locale === 'bn' && 'leading-[1.7]',
      )}
    >
      <SkipLink>{home.shell.skip}</SkipLink>
      <header className="bg-shell text-white md:sticky md:top-0 md:z-40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3.5 sm:px-6">
          <Link href={publicPath('home', locale)} className="flex min-w-0 items-center gap-3">
            {/* The client's logo mark (owner, 2026-11-10), on a white tile: its green would vanish on the deep-green shell. */}
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-white p-1"
            >
              <Image src={siratMark} alt="" width={32} height={32} unoptimized priority />
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
        <nav aria-label={p.menu.label} className="border-t border-white/10">
          <ul className="mx-auto hidden max-w-6xl flex-wrap gap-1 px-4 py-2 text-sm font-semibold sm:px-6 md:flex">
            {menu.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={item.current ? 'page' : undefined}
                  className={cn(
                    'block rounded-full px-3 py-1.5 hover:bg-white/10 hover:text-white',
                    item.current ? 'bg-white/10 text-white' : 'text-white/80',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <details className="group md:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2">
                <Menu aria-hidden="true" className="h-5 w-5" />
                {p.menu.open}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="h-5 w-5 group-open:rotate-180 motion-safe:transition-transform"
              />
            </summary>
            <ul className="flex flex-col gap-1 px-2 pb-3 text-base font-semibold">
              {menu.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={item.current ? 'page' : undefined}
                    className={cn(
                      'block rounded-control px-3 py-3 hover:bg-white/10 hover:text-white',
                      item.current ? 'bg-white/10 text-white' : 'text-white/85',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </nav>
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
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:px-6 lg:grid-cols-[1.4fr_2fr_1fr]">
          <div>
            <p className="flex items-center gap-2 text-base font-extrabold text-ink">
              <Image src={siratMark} alt="" aria-hidden="true" width={20} height={20} unoptimized />
              {home.brand.name}
            </p>
            <p lang={seasonLang} className="mt-1 font-medium text-ink-muted">
              {home.brand.season}
            </p>
            <p className="mt-3 max-w-sm leading-relaxed text-ink-muted">
              <WithHonorific text={home.hero.tagline} honorific={home.brand.honorific} />
            </p>
          </div>
          <nav aria-label={home.shell.footerNav} className="grid gap-8 sm:grid-cols-2">
            <div>
              <h2 className="font-bold text-ink">{p.footer.olympiad}</h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {menu.map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} className={footerLink}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-bold text-ink">{p.footer.takePart}</h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                <li>
                  <Link href="/register" className={footerLink}>
                    {p.footer.register}
                  </Link>
                </li>
                <li>
                  <Link href="/login" className={footerLink}>
                    {p.footer.login}
                  </Link>
                </li>
              </ul>
              <h2 className="mt-5 font-bold text-ink">{p.footer.policies}</h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {policies.map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} className={footerLink}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
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
