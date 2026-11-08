import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Flag,
  HelpCircle,
  Images,
  Mail,
  ScrollText,
  Trophy,
  UserPlus,
  Wallet,
} from 'lucide-react';
import {
  buttonClasses,
  GeometricPattern,
  Section,
  StarMark,
  StarOrnament,
  Timeline,
  WithHonorific,
} from '@sirat/ui';
import { homeFacts } from '@/content/home';
import { MENU_PAGES, publicPath, type MenuPage } from '@/content/site';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { homeMessages } from '@/i18n/messages/home';
import { pagesMessages } from '@/i18n/messages/pages';
import { getRegistrationInfo, type PublicRegistrationInfo } from '@/lib/public-api';
import { PublicShell } from '../PublicShell';
import { formatDay, registrationWindow } from './home-view';
import { FinalCta, HighlightsSection, type HomeText } from './sections';

/*
 * The public homepage: an overview of the multi-page site (owner, 2026-11-08). Hero, a short intro, a card for
 * each page of the menu, the dated milestones and last season's numbers. Server-rendered and revalidated with the fee (lib/public-api.ts): no cookie or header is read.
 * Every word comes from i18n (home.ts, pages.ts), every fact from content/home.ts. Geometry only, never a figure.
 */

type PagesText = (typeof pagesMessages)['en'];

const CARD_ICONS: Record<MenuPage, typeof Flag> = {
  about: ScrollText,
  participate: ClipboardList,
  rounds: Flag,
  prizes: Trophy,
  syllabus: BookOpen,
  ambassador: UserPlus,
  gallery: Images,
  faq: HelpCircle,
  contact: Mail,
};

export async function HomePage({ locale }: { locale: Locale }) {
  const m = pick(homeMessages, locale);
  const p = pick(pagesMessages, locale);
  const info = await getRegistrationInfo();
  const fee = info?.fee
    ? m.fee.amount(formatNumber(locale, info.fee.amountMinor / 100), info.fee.currency)
    : null;
  return (
    <PublicShell locale={locale} page="home" bleed>
      <Hero m={m} locale={locale} info={info} fee={fee} />
      <IntroTeaser m={m} p={p} locale={locale} />
      <ExploreSection p={p} locale={locale} />
      <DatesSection m={m} p={p} locale={locale} />
      <HighlightsSection m={m} />
      <FinalCta m={m} />
    </PublicShell>
  );
}

/** The intro's first paragraph beside the quote, and the way to the About page. */
function IntroTeaser({ m, p, locale }: { m: HomeText; p: PagesText; locale: Locale }) {
  return (
    <Section id="intro" kicker={m.intro.kicker} title={m.intro.title} align="start">
      <div className="grid items-start gap-8 lg:grid-cols-[1.5fr_1fr] lg:gap-12">
        <div>
          <p className="text-lg leading-[1.85] text-ink-muted">
            <WithHonorific text={m.intro.paragraphs[0]} honorific={m.brand.honorific} />
          </p>
          <Link
            href={publicPath('about', locale)}
            className="mt-6 inline-flex min-h-6 items-center gap-1.5 font-semibold text-secondary underline-offset-4 hover:underline"
          >
            {p.home.introMore}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
        <figure className="relative isolate overflow-hidden rounded-card bg-secondary p-8 text-white shadow-card">
          <GeometricPattern id="home-quote-pattern" size={48} className="text-white/[0.07]" />
          <span
            aria-hidden="true"
            className="block text-6xl leading-none font-extrabold text-accent"
          >
            “
          </span>
          <blockquote className="-mt-2 text-lg leading-[1.8] font-semibold">
            <p>{m.intro.quote}</p>
          </blockquote>
        </figure>
      </div>
    </Section>
  );
}

/** A card for each topic page: the overview of the site. */
function ExploreSection({ p, locale }: { p: PagesText; locale: Locale }) {
  return (
    <Section
      id="explore"
      surface="surface"
      kicker={p.home.explore.kicker}
      title={p.home.explore.title}
      lead={p.home.explore.lead}
    >
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {MENU_PAGES.map((key) => {
          const Icon = CARD_ICONS[key];
          return (
            <li key={key}>
              <Link
                href={publicPath(key, locale)}
                className="group flex h-full flex-col rounded-card border border-line bg-page p-6 hover:border-primary hover:bg-surface hover:shadow-card motion-safe:transition-colors"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-control bg-primary-soft text-primary-strong">
                  <Icon aria-hidden="true" className="h-6 w-6" />
                </span>
                <h3 className="mt-4 text-xl font-extrabold text-ink">{p.menu[key]}</h3>
                <p className="mt-2 flex-1 leading-relaxed text-ink-muted">{p.home.cards[key]}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-secondary">
                  {p.home.open}
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** The dated milestones (content/home.ts), and the way to the full timeline. */
function DatesSection({ m, p, locale }: { m: HomeText; p: PagesText; locale: Locale }) {
  const items = homeFacts.roadmap
    .filter((entry) => entry.from)
    .map((entry) => ({
      id: entry.key,
      title: m.roadmap[entry.key],
      when: formatDay(locale, entry.from as string, entry.to),
    }));
  return (
    <Section id="dates" surface="tint" kicker={p.home.dates.kicker} title={p.home.dates.title}>
      <div className="mx-auto max-w-xl rounded-card border border-line bg-surface p-6 md:p-8">
        <Timeline items={items} />
      </div>
      <p className="mt-6 text-center">
        <Link
          href={`${publicPath('rounds', locale)}#roadmap`}
          className="inline-flex min-h-6 items-center gap-1.5 font-semibold text-secondary underline-offset-4 hover:underline"
        >
          {p.home.dates.all}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </p>
    </Section>
  );
}

function Hero({
  m,
  locale,
  info,
  fee,
}: {
  m: HomeText;
  locale: Locale;
  info: PublicRegistrationInfo | null;
  fee: string | null;
}) {
  const window = registrationWindow(homeFacts.roadmap);
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden bg-shell text-white"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-linear-to-br from-shell via-shell to-secondary"
      />
      <GeometricPattern
        id="hero-pattern"
        size={72}
        className="text-white/[0.06] [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />
      <StarOrnament className="pointer-events-none absolute -top-10 -right-36 -z-10 h-96 w-96 text-accent/30 md:top-1/2 md:-right-24 md:h-[36rem] md:w-[36rem] md:-translate-y-1/2 motion-safe:animate-[spin_240s_linear_infinite]" />
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 md:pt-24 md:pb-24">
        <div className="max-w-3xl motion-safe:animate-rise">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm font-semibold text-white/90">
            <StarMark className="h-3.5 w-3.5 text-accent" />
            <span lang={locale === 'bn' ? 'en' : undefined}>{m.brand.season}</span>
          </p>
          <h1
            id="hero-title"
            className="mt-6 text-4xl leading-[1.25] font-extrabold text-balance sm:text-5xl md:text-6xl"
          >
            {m.brand.name}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/80 md:text-xl">
            <WithHonorific text={m.hero.tagline} honorific={m.brand.honorific} />
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className={buttonClasses({ size: 'lg' })}>
              {m.hero.register}
              <ArrowRight aria-hidden="true" className="h-5 w-5" />
            </Link>
            <Link
              href={publicPath('participate', locale)}
              className="inline-flex items-center justify-center rounded-control border border-white/25 px-6 py-3 font-semibold text-white hover:bg-white/10"
            >
              {m.hero.howTo}
            </Link>
          </div>
          <ul className="mt-10 flex flex-col gap-3 text-sm text-white/80 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {window ? (
              <li className="flex items-center gap-2">
                <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
                {m.hero.window(formatDay(locale, window.from), formatDay(locale, window.to))}
              </li>
            ) : null}
            {info ? (
              <li className="flex items-center gap-2">
                <BadgeCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
                {info.open ? m.hero.open : m.hero.closed}
              </li>
            ) : null}
            <li className="flex items-center gap-2">
              <Wallet aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
              {fee ? m.fee.line(fee) : m.fee.unknown}
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
