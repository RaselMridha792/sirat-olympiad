import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, BookOpen, Images, ScrollText, Sparkles } from 'lucide-react';
import {
  BigStats,
  buttonClasses,
  GeometricPattern,
  Section,
  StarMark,
  StarOrnament,
  WithHonorific,
} from '@sirat/ui';
import { homeFacts, safeExternalUrl } from '@/content/home';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import type { homeMessages } from '@/i18n/messages/home';

/*
 * Bands shared by the homepage and the About page (the client's PDF puts the same intro, goals and numbers on both).
 * Server components: text from i18n, facts from content/, no request data.
 */

export type HomeText = (typeof homeMessages)['en'];

/** The dark opening band of an inner page: kicker, h1 and lead over the star lattice. */
export function PageHero({
  kicker,
  title,
  lead,
}: {
  kicker: string;
  title: string;
  lead: ReactNode;
}) {
  return (
    <section
      aria-labelledby="page-title"
      className="relative isolate overflow-hidden bg-shell text-white"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-linear-to-br from-shell via-shell to-secondary"
      />
      <GeometricPattern
        id="page-hero-pattern"
        size={72}
        className="text-white/[0.06] [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />
      <StarOrnament className="pointer-events-none absolute -top-16 -right-32 -z-10 h-96 w-96 text-primary/25 md:-right-16 md:h-[30rem] md:w-[30rem] motion-safe:animate-[spin_240s_linear_infinite]" />
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 md:pt-20 md:pb-20">
        <div className="max-w-3xl motion-safe:animate-rise">
          <p className="inline-flex items-center gap-2 text-sm font-bold text-primary">
            <StarMark className="h-3.5 w-3.5" />
            {kicker}
          </p>
          <h1
            id="page-title"
            className="mt-4 text-3xl leading-[1.3] font-extrabold text-balance sm:text-4xl md:text-5xl"
          >
            {title}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-white/80">{lead}</p>
        </div>
      </div>
    </section>
  );
}

/** অলিম্পিয়াড পরিচিতি: the client's two paragraphs beside the quote. */
export function IntroSection({ m }: { m: HomeText }) {
  return (
    <Section id="intro" kicker={m.intro.kicker} title={m.intro.title} align="start">
      <div className="grid items-start gap-8 lg:grid-cols-[1.5fr_1fr] lg:gap-12">
        <div className="flex flex-col gap-5 text-lg leading-[1.85] text-ink-muted">
          {m.intro.paragraphs.map((text) => (
            <p key={text}>
              <WithHonorific text={text} honorific={m.brand.honorific} />
            </p>
          ))}
        </div>
        <figure className="relative isolate overflow-hidden rounded-card bg-secondary p-8 text-white shadow-card md:p-10">
          <GeometricPattern id="quote-pattern" size={48} className="text-white/[0.07]" />
          <span
            aria-hidden="true"
            className="block text-7xl leading-none font-extrabold text-primary"
          >
            “
          </span>
          <blockquote className="-mt-2 text-xl leading-[1.8] font-semibold">
            <p>{m.intro.quote}</p>
          </blockquote>
        </figure>
      </div>
    </Section>
  );
}

const GOAL_ICONS = [BookOpen, ScrollText, Sparkles];

/** লক্ষ্য ও উদ্দেশ্য: the client's aim, its three objectives as cards, the closing words; `children` adds more. */
export function GoalsSection({
  m,
  locale,
  children,
}: {
  m: HomeText;
  locale: Locale;
  children?: ReactNode;
}) {
  return (
    <Section id="goals" surface="surface" kicker={m.goals.kicker} title={m.goals.title}>
      <p className="mx-auto max-w-3xl text-lg leading-[1.85] text-ink-muted">
        <WithHonorific text={m.goals.lead} honorific={m.brand.honorific} />
      </p>
      <ol className="mt-10 grid gap-5 md:grid-cols-3">
        {m.goals.items.map((goal, index) => {
          const Icon = GOAL_ICONS[index] ?? Sparkles;
          return (
            <li
              key={goal}
              className="rounded-card border border-line bg-page p-7 motion-safe:transition-transform motion-safe:hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-control bg-primary-soft text-primary-strong">
                  <Icon aria-hidden="true" className="h-6 w-6" />
                </span>
                <span aria-hidden="true" className="text-3xl font-extrabold text-line">
                  {formatNumber(locale, index + 1)}
                </span>
              </div>
              <p className="mt-5 text-lg leading-snug font-bold">{goal}</p>
            </li>
          );
        })}
      </ol>
      {children}
      <p className="mx-auto mt-10 max-w-3xl leading-[1.85] text-ink-muted">
        <WithHonorific text={m.goals.closing} honorific={m.brand.honorific} />
      </p>
    </Section>
  );
}

/** গত আসর: last season's numbers, and the album link once the client's URL is in content/home.ts. */
export function HighlightsSection({ m }: { m: HomeText }) {
  const album = safeExternalUrl(homeFacts.albumUrl);
  return (
    <Section
      id="highlights"
      surface="shell"
      kicker={m.highlights.kicker}
      title={m.highlights.title}
      lead={m.highlights.lead}
      decoration={
        <GeometricPattern id="highlights-pattern" size={56} className="text-white/[0.05]" />
      }
    >
      <BigStats items={m.highlights.stats} tone="dark" />
      {album ? (
        <div className="mt-10 text-center">
          <a
            href={album}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ size: 'lg' })}
          >
            <Images aria-hidden="true" className="h-5 w-5" />
            {m.highlights.album}
            <span className="sr-only"> {m.highlights.newTab}</span>
          </a>
        </div>
      ) : null}
    </Section>
  );
}

/** The closing call to register. */
export function FinalCta({ m }: { m: HomeText }) {
  return (
    <section
      aria-labelledby="final-cta-title"
      className="relative isolate overflow-hidden bg-primary-strong px-4 py-16 text-white sm:px-6 md:py-20"
    >
      <GeometricPattern id="final-cta-pattern" size={56} className="text-white/[0.09]" />
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 text-center">
        <StarMark className="h-8 w-8 text-white/80" />
        <h2
          id="final-cta-title"
          className="max-w-3xl text-3xl leading-snug font-extrabold text-balance md:text-4xl"
        >
          {m.finalCta.title}
        </h2>
        <Link
          href="/register"
          className="inline-flex items-center gap-2 rounded-control bg-white px-7 py-3.5 text-lg font-bold text-primary-strong hover:bg-primary-soft"
        >
          {m.finalCta.cta}
          <ArrowRight aria-hidden="true" className="h-5 w-5" />
        </Link>
      </div>
    </section>
  );
}
