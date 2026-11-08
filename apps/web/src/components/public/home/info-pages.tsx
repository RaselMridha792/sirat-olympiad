import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  ChartLine,
  ClipboardCheck,
  Clock,
  Gift,
  HelpCircle,
  Images,
  Save,
  ScrollText,
  ShieldCheck,
  Ticket,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { Accordion, Section } from '@sirat/ui';
import { homeFacts, safeExternalUrl } from '@/content/home';
import { publicPath } from '@/content/site';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { homeMessages } from '@/i18n/messages/home';
import { morePagesMessages } from '@/i18n/messages/pages-more';
import { pagesMessages } from '@/i18n/messages/pages';
import { getRegistrationInfo } from '@/lib/public-api';
import { PublicShell } from '../PublicShell';
import {
  AmbassadorSection,
  ContactSection,
  FAQ_TARGETS,
  faqHref,
  GroupsSection,
  PrizesSection,
  RoadmapSection,
  RoundsSection,
  SyllabusSection,
  type FaqTarget,
} from './blocks';
import { formatDay, registrationWindow } from './home-view';
import { FinalCta, HighlightsSection, PageHero } from './sections';

/*
 * The topic pages of the multi-page public site (owner, 2026-11-08): How to take part, Rounds and dates, Prizes,
 * Syllabus, Ambassadors, Gallery, FAQ, Contact. Each is a page hero (the page's one h1) and bands: the homepage's bands where the topic had one, and
 * this page's own. Static: the fee is the only API read (revalidated with the route). Texts from
 * i18n/messages/pages.ts and home.ts, facts from content/home.ts.
 */

/** A card with an icon tile, a heading and a text: the building block of the topic pages' own bands. */
function InfoCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-card border border-line bg-surface p-6 shadow-card">
      <span className="flex h-11 w-11 items-center justify-center rounded-control bg-primary-soft text-primary-strong">
        {icon}
      </span>
      <h3 className="mt-4 text-lg leading-snug font-bold">{title}</h3>
      <div className="mt-2 leading-relaxed text-ink-muted">{children}</div>
    </article>
  );
}

async function feeLine(locale: Locale): Promise<string | null> {
  const m = pick(homeMessages, locale);
  const info = await getRegistrationInfo();
  return info?.fee
    ? m.fee.amount(formatNumber(locale, info.fee.amountMinor / 100), info.fee.currency)
    : null;
}

export async function ParticipatePage({ locale }: { locale: Locale }) {
  const m = pick(homeMessages, locale);
  const t = pick(pagesMessages, locale).participate;
  const fee = await feeLine(locale);
  const window = registrationWindow(homeFacts.roadmap);
  const getIcons = [Gift, BadgeCheck, ChartLine];
  const examIcons = [Clock, ShieldCheck, Save, ClipboardCheck];
  return (
    <PublicShell locale={locale} page="participate" bleed>
      <PageHero kicker={t.hero.kicker} title={t.hero.title} lead={t.hero.lead} />
      <GroupsSection m={m} fee={fee} />
      <Section
        id="steps"
        surface="surface"
        kicker={t.steps.kicker}
        title={t.steps.title}
        lead={
          window
            ? t.window(formatDay(locale, window.from), formatDay(locale, window.to))
            : undefined
        }
      >
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {t.steps.items.map((step, index) => (
            <li key={step.title} className="rounded-card border border-line bg-page p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-strong text-lg font-extrabold text-white">
                {formatNumber(locale, index + 1)}
              </span>
              <h3 className="mt-4 text-lg leading-snug font-bold">{step.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-muted">{step.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-center">
          <Link
            href="/register"
            className="inline-flex min-h-6 items-center gap-1.5 font-semibold text-secondary underline-offset-4 hover:underline"
          >
            {m.hero.register}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </p>
      </Section>
      <Section id="benefits" kicker={t.get.kicker} title={t.get.title}>
        <div className="grid gap-5 md:grid-cols-3">
          {t.get.items.map((item, index) => {
            const Icon = getIcons[index] ?? Gift;
            return (
              <InfoCard
                key={item.title}
                icon={<Icon aria-hidden="true" className="h-5 w-5" />}
                title={item.title}
              >
                <p>{item.text}</p>
              </InfoCard>
            );
          })}
        </div>
      </Section>
      <Section id="exam" surface="tint" kicker={t.exam.kicker} title={t.exam.title}>
        <div className="grid gap-5 md:grid-cols-2">
          {t.exam.items.map((item, index) => {
            const Icon = examIcons[index] ?? Clock;
            return (
              <InfoCard
                key={item.title}
                icon={<Icon aria-hidden="true" className="h-5 w-5" />}
                title={item.title}
              >
                <p>{item.text}</p>
              </InfoCard>
            );
          })}
        </div>
        <p className="mt-8 text-center text-ink-muted">
          {t.rules.text}{' '}
          <Link
            href={publicPath('terms', locale)}
            className="inline-flex min-h-6 items-center font-semibold text-secondary underline-offset-4 hover:underline"
          >
            {t.rules.link}
          </Link>
        </p>
      </Section>
      <FinalCta m={m} />
    </PublicShell>
  );
}

export function RoundsPage({ locale }: { locale: Locale }) {
  const m = pick(homeMessages, locale);
  const t = pick(pagesMessages, locale).rounds;
  return (
    <PublicShell locale={locale} page="rounds" bleed>
      <PageHero kicker={t.hero.kicker} title={t.hero.title} lead={t.hero.lead} />
      <RoundsSection m={m} locale={locale} />
      <Section id="final" title={t.final.title} align="start">
        <p className="max-w-3xl text-lg leading-relaxed text-ink-muted">{t.final.text}</p>
      </Section>
      <RoadmapSection m={m} locale={locale} />
      <Section id="results" surface="tint" kicker={t.results.kicker} title={t.results.title}>
        <ul className="mx-auto flex max-w-3xl flex-col gap-4">
          {t.results.items.map((text) => (
            <li
              key={text}
              className="flex gap-3 rounded-card border border-line bg-surface p-5 shadow-card"
            >
              <ChartLine aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-primary-strong" />
              <span className="leading-relaxed text-ink-muted">{text}</span>
            </li>
          ))}
        </ul>
      </Section>
      <FinalCta m={m} />
    </PublicShell>
  );
}

export function PrizesPage({ locale }: { locale: Locale }) {
  const m = pick(homeMessages, locale);
  const t = pick(pagesMessages, locale).prizes;
  return (
    <PublicShell locale={locale} page="prizes" bleed>
      <PageHero kicker={t.hero.kicker} title={t.hero.title} lead={t.hero.lead} />
      <PrizesSection m={m} detail={{ locale, perGroup: t.perGroup, pool: t.pool }} />
      <Section
        id="certificates"
        surface="surface"
        kicker={t.certificates.kicker}
        title={t.certificates.title}
      >
        <ul className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
          {t.certificates.items.map((item, index) => (
            <li key={item.title}>
              <InfoCard
                icon={
                  index === 0 ? (
                    <ScrollText aria-hidden="true" className="h-5 w-5" />
                  ) : (
                    <ShieldCheck aria-hidden="true" className="h-5 w-5" />
                  )
                }
                title={item.title}
              >
                <p>{item.text}</p>
              </InfoCard>
            </li>
          ))}
        </ul>
      </Section>
      <FinalCta m={m} />
    </PublicShell>
  );
}

export function SyllabusPage({ locale }: { locale: Locale }) {
  const m = pick(homeMessages, locale);
  const t = pick(pagesMessages, locale).syllabus;
  return (
    <PublicShell locale={locale} page="syllabus" bleed>
      <PageHero kicker={t.hero.kicker} title={t.hero.title} lead={t.hero.lead} />
      <SyllabusSection m={m} locale={locale} />
      <Section id="questions" surface="tint" kicker={t.prep.kicker} title={t.prep.title}>
        <div className="grid gap-5 md:grid-cols-2">
          <InfoCard
            icon={<HelpCircle aria-hidden="true" className="h-5 w-5" />}
            title={t.questions.title}
          >
            <ul className="flex list-disc flex-col gap-2 pl-5">
              {t.questions.items.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </InfoCard>
          <InfoCard
            icon={<BookOpen aria-hidden="true" className="h-5 w-5" />}
            title={t.books.title}
          >
            <p>{t.books.text}</p>
          </InfoCard>
        </div>
      </Section>
      <FinalCta m={m} />
    </PublicShell>
  );
}

/** The ambassador programme: the homepage's band (what they do, how to join) and how it works in the system. */
export function AmbassadorPage({ locale }: { locale: Locale }) {
  const m = pick(homeMessages, locale);
  const t = pick(morePagesMessages, locale).ambassador;
  const icons = [Ticket, UserPlus, ChartLine, ClipboardCheck, Users];
  return (
    <PublicShell locale={locale} page="ambassador" bleed>
      <PageHero kicker={t.hero.kicker} title={t.hero.title} lead={t.hero.lead} />
      <AmbassadorSection m={m} locale={locale} />
      <Section id="how" surface="tint" kicker={t.how.kicker} title={t.how.title}>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {t.how.items.map((item, index) => {
            const Icon = icons[index] ?? UserPlus;
            return (
              <InfoCard
                key={item.title}
                icon={<Icon aria-hidden="true" className="h-5 w-5" />}
                title={item.title}
              >
                <p>{item.text}</p>
              </InfoCard>
            );
          })}
        </div>
      </Section>
      <FinalCta m={m} />
    </PublicShell>
  );
}

/** Last season: the numbers and, once the client's link is in content/home.ts, the album. */
export function GalleryPage({ locale }: { locale: Locale }) {
  const m = pick(homeMessages, locale);
  const t = pick(morePagesMessages, locale).gallery;
  const album = safeExternalUrl(homeFacts.albumUrl);
  return (
    <PublicShell locale={locale} page="gallery" bleed>
      <PageHero kicker={t.hero.kicker} title={t.hero.title} lead={t.hero.lead} />
      <HighlightsSection m={m} />
      {album ? null : (
        <section aria-label={t.title} className="px-4 py-12 sm:px-6">
          <p className="mx-auto flex max-w-2xl items-center justify-center gap-3 rounded-card border border-dashed border-line bg-surface p-6 text-center text-ink-muted">
            <Images aria-hidden="true" className="h-6 w-6 shrink-0 text-primary-strong" />
            {t.soon}
          </p>
        </section>
      )}
      <FinalCta m={m} />
    </PublicShell>
  );
}

type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  link?: { href: string; label: string };
};

/** All the questions, in groups: the website PDF's, the homepage's, and how the system answers the rest. */
export async function FaqPage({ locale }: { locale: Locale }) {
  const m = pick(homeMessages, locale);
  const t = pick(morePagesMessages, locale).faq;
  const fee = await feeLine(locale);
  const closes = homeFacts.roadmap.find((entry) => entry.key === 'registrationCloses')?.from;
  const fromHome = (id: string): FaqEntry | null => {
    const item = m.faq.items.find((entry) => entry.id === id);
    if (!item) return null;
    const target = FAQ_TARGETS.includes(item.id) ? (item.id as FaqTarget) : null;
    return {
      id: item.id,
      question: item.question,
      answer: item.answer,
      link: target ? { href: faqHref(target, locale), label: m.faq.links[target] } : undefined,
    };
  };
  const groups: Array<{ id: string; title: string; items: Array<FaqEntry | null> }> = [
    {
      id: 'registration',
      title: t.groups.registration,
      items: [
        fromHome('register'),
        {
          id: 'how',
          ...t.how,
          link: { href: publicPath('participate', locale), label: t.links.participate },
        },
        closes
          ? {
              id: 'deadline',
              question: t.deadline.question,
              answer: t.deadline.answer(formatDay(locale, closes)),
            }
          : null,
        { id: 'fee', question: t.fee.question, answer: fee ? t.fee.answer(fee) : t.fee.unknown },
      ],
    },
    {
      id: 'exam',
      title: t.groups.exam,
      items: [
        fromHome('roadmap'),
        fromHome('method'),
        fromHome('final'),
        fromHome('syllabus'),
        fromHome('books'),
      ],
    },
    {
      id: 'results',
      title: t.groups.results,
      items: [
        { id: 'results', ...t.results },
        { id: 'certificate', ...t.certificate },
        fromHome('prizes'),
      ],
    },
    {
      id: 'payment',
      title: t.groups.payment,
      items: [
        {
          id: 'stuck',
          ...t.stuck,
          link: { href: publicPath('contact', locale), label: t.links.contact },
        },
        {
          id: 'refund',
          ...t.refund,
          link: { href: publicPath('refund', locale), label: t.links.refund },
        },
      ],
    },
    {
      id: 'ambassador',
      title: t.groups.ambassador,
      items: [
        {
          id: 'who',
          ...t.who,
          link: { href: publicPath('ambassador', locale), label: t.links.ambassador },
        },
        { id: 'points', ...t.points },
      ],
    },
  ];
  return (
    <PublicShell locale={locale} page="faq" bleed>
      <PageHero kicker={t.hero.kicker} title={t.hero.title} lead={t.hero.lead} />
      {groups.map((group, index) => (
        <Section
          key={group.id}
          id={`faq-${group.id}`}
          surface={index % 2 ? 'surface' : 'page'}
          title={group.title}
          className="md:py-16"
        >
          <Accordion
            name={`faq-${group.id}`}
            className="mx-auto max-w-3xl"
            items={group.items
              .filter((item): item is FaqEntry => item !== null)
              .map((item) => ({
                id: `faq-${group.id}-${item.id}`,
                question: item.question,
                answer: (
                  <>
                    <p>{item.answer}</p>
                    {item.link ? (
                      <p className="mt-3">
                        <Link
                          href={item.link.href}
                          className="inline-flex min-h-6 items-center gap-1 font-semibold text-secondary underline-offset-4 hover:underline"
                        >
                          {item.link.label}
                          <ArrowRight aria-hidden="true" className="h-4 w-4" />
                        </Link>
                      </p>
                    ) : null}
                  </>
                ),
              }))}
          />
        </Section>
      ))}
      <FinalCta m={m} />
    </PublicShell>
  );
}

/** Contact: the email and the social links, and what helps us answer. No form: there is no backend for it. */
export function ContactPage({ locale }: { locale: Locale }) {
  const m = pick(homeMessages, locale);
  const t = pick(morePagesMessages, locale).contact;
  return (
    <PublicShell locale={locale} page="contact" bleed>
      <PageHero kicker={t.hero.kicker} title={t.hero.title} lead={t.hero.lead} />
      <ContactSection m={m} />
      <Section id="help" surface="surface" kicker={t.help.kicker} title={t.help.title}>
        <div className="grid gap-5 md:grid-cols-3">
          <InfoCard
            icon={<Wallet aria-hidden="true" className="h-5 w-5" />}
            title={t.help.payment.title}
          >
            <p>{t.help.payment.text}</p>
          </InfoCard>
          <InfoCard
            icon={<Clock aria-hidden="true" className="h-5 w-5" />}
            title={t.help.reply.title}
          >
            <p>{t.help.reply.text}</p>
          </InfoCard>
          <InfoCard
            icon={<HelpCircle aria-hidden="true" className="h-5 w-5" />}
            title={t.help.faq.title}
          >
            <p>{t.help.faq.text}</p>
            <Link
              href={publicPath('faq', locale)}
              className="mt-3 inline-flex min-h-6 items-center gap-1 font-semibold text-secondary underline-offset-4 hover:underline"
            >
              {t.help.faq.link}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </InfoCard>
        </div>
      </Section>
    </PublicShell>
  );
}
