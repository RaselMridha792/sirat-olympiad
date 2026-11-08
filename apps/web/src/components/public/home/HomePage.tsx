import Link from 'next/link';
import {
  ArrowRight,
  Award,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  ChartLine,
  ClipboardList,
  Facebook,
  Footprints,
  Gift,
  GraduationCap,
  Info,
  Instagram,
  Mail,
  MapPin,
  Medal,
  ScrollText,
  Send,
  Star,
  Target,
  Trophy,
  UserPlus,
  Users,
  Wallet,
  Wifi,
  Youtube,
} from 'lucide-react';
import {
  Accordion,
  buttonClasses,
  GeometricPattern,
  Section,
  StarMark,
  StarOrnament,
  Timeline,
  WithHonorific,
} from '@sirat/ui';
import { homeFacts, safeExternalUrl, type SocialLink } from '@/content/home';
import { site } from '@/content/site';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { homeMessages } from '@/i18n/messages/home';
import { getRegistrationInfo, type PublicRegistrationInfo } from '@/lib/public-api';
import { PublicShell } from '../PublicShell';
import { formatDay, participationModes, registrationWindow } from './home-view';
import { FinalCta, GoalsSection, HighlightsSection, IntroSection, type HomeText } from './sections';

/*
 * The public homepage, FIRST DRAFT (owner, 2026-11-03; DECISIONS). Server-rendered and revalidated with the fee
 * (lib/public-api.ts): no cookie or header is read. Every word comes from i18n/messages/home.ts, every fact from
 * content/home.ts, the fee and the open state from the API. Geometry only, never a figure.
 */

const SECTION_NAV = [
  'intro',
  'groups',
  'syllabus',
  'rounds',
  'prizes',
  'roadmap',
  'highlights',
  'ambassador',
  'faq',
  'contact',
] as const;

export async function HomePage({ locale }: { locale: Locale }) {
  const m = pick(homeMessages, locale);
  const info = await getRegistrationInfo();
  const fee = info?.fee
    ? m.fee.amount(formatNumber(locale, info.fee.amountMinor / 100), info.fee.currency)
    : null;
  return (
    <PublicShell locale={locale} page="home" bleed>
      <Hero m={m} locale={locale} info={info} fee={fee} />
      <nav
        aria-label={m.sectionNav.label}
        className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur"
      >
        <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2 text-sm font-semibold whitespace-nowrap [scrollbar-width:none] sm:px-6">
          {SECTION_NAV.map((id) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="block rounded-full px-3 py-1.5 text-ink-muted hover:bg-page hover:text-ink"
              >
                {m.sectionNav[id]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <IntroSection m={m} />
      <GoalsSection m={m} locale={locale} />
      <GroupsSection m={m} fee={fee} />
      <SyllabusSection m={m} locale={locale} />
      <RoundsSection m={m} locale={locale} />
      <PrizesSection m={m} />
      <RoadmapSection m={m} locale={locale} />
      <HighlightsSection m={m} />
      <AmbassadorSection m={m} />
      <FaqSection m={m} />
      <ContactSection m={m} />
      <FinalCta m={m} />
    </PublicShell>
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
      <StarOrnament className="pointer-events-none absolute -top-10 -right-36 -z-10 h-96 w-96 text-primary/30 md:top-1/2 md:-right-24 md:h-[36rem] md:w-[36rem] md:-translate-y-1/2 motion-safe:animate-[spin_240s_linear_infinite]" />
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 md:pt-24 md:pb-24">
        <div className="max-w-3xl motion-safe:animate-rise">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm font-semibold text-white/90">
            <StarMark className="h-3.5 w-3.5 text-primary" />
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
            <a
              href="#groups"
              className="inline-flex items-center justify-center rounded-control border border-white/25 px-6 py-3 font-semibold text-white hover:bg-white/10"
            >
              {m.hero.howTo}
            </a>
          </div>
          <ul className="mt-10 flex flex-col gap-3 text-sm text-white/80 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {window ? (
              <li className="flex items-center gap-2">
                <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
                {m.hero.window(formatDay(locale, window.from), formatDay(locale, window.to))}
              </li>
            ) : null}
            {info ? (
              <li className="flex items-center gap-2">
                <BadgeCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
                {info.open ? m.hero.open : m.hero.closed}
              </li>
            ) : null}
            <li className="flex items-center gap-2">
              <Wallet aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
              {fee ? m.fee.line(fee) : m.fee.unknown}
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function GroupsSection({ m, fee }: { m: HomeText; fee: string | null }) {
  const groups = [
    { key: 'junior', Icon: GraduationCap, ...m.groups.junior },
    { key: 'senior', Icon: Users, ...m.groups.senior },
  ];
  const modeIcons = { online: Wifi, offline: MapPin };
  return (
    <Section
      id="groups"
      surface="tint"
      kicker={m.groups.kicker}
      title={m.groups.title}
      lead={m.groups.lead}
    >
      <div className="grid gap-5 md:grid-cols-2">
        {groups.map(({ key, Icon, name, age, who }) => (
          <article
            key={key}
            className="rounded-card border border-line bg-surface p-7 shadow-card motion-safe:transition-transform motion-safe:hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-control bg-secondary-soft text-secondary">
                <Icon aria-hidden="true" className="h-6 w-6" />
              </span>
              <span className="rounded-full bg-secondary px-3 py-1 text-sm font-bold text-white">
                {age}
              </span>
            </div>
            <h3 className="mt-5 text-2xl font-extrabold">{name}</h3>
            <p className="mt-2 leading-relaxed text-ink-muted">{who}</p>
          </article>
        ))}
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-7 shadow-card">
          <h3 className="text-lg font-bold">{m.groups.modeTitle}</h3>
          <ul className="mt-4 flex flex-col gap-4">
            {participationModes(homeFacts).map((mode) => {
              const Icon = modeIcons[mode];
              return (
                <li key={mode} className="flex gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-semibold">{m.groups[mode].title}</p>
                    <p className="mt-0.5 leading-relaxed text-ink-muted">{m.groups[mode].text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex flex-col rounded-card bg-shell p-7 text-white shadow-card">
          <h3 className="text-lg font-bold">{m.groups.feeTitle}</h3>
          {fee ? (
            <p className="mt-3 text-4xl font-extrabold tabular-nums">{fee}</p>
          ) : (
            <p className="mt-3 text-white/80">{m.fee.unknown}</p>
          )}
          <p className="mt-3 text-sm leading-relaxed text-white/75">{m.groups.feeNote}</p>
          <Link href="/register" className={buttonClasses({ className: 'mt-6 self-start' })}>
            {m.hero.register}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </Section>
  );
}

function SyllabusSection({ m, locale }: { m: HomeText; locale: Locale }) {
  return (
    <Section
      id="syllabus"
      surface="surface"
      kicker={m.syllabus.kicker}
      title={m.syllabus.title}
      lead={m.syllabus.lead}
    >
      <div className="grid gap-5 md:grid-cols-2">
        {[m.syllabus.junior, m.syllabus.senior].map((group) => (
          <article key={group.group} className="rounded-card border border-line bg-page p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xl font-extrabold">{group.group}</h3>
              <span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary-strong">
                {m.syllabus.count(formatNumber(locale, group.books.length))}
              </span>
            </div>
            <ul className="mt-5 flex flex-col gap-3">
              {group.books.map((book) => (
                <li
                  key={book}
                  className="flex items-center gap-3 rounded-control bg-surface px-4 py-3 font-semibold shadow-card"
                >
                  <BookOpen aria-hidden="true" className="h-5 w-5 shrink-0 text-primary-strong" />
                  {book}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-4 rounded-card border border-primary/30 bg-primary-soft p-6 sm:flex-row sm:items-center md:p-7">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-strong text-white">
          <Gift aria-hidden="true" className="h-6 w-6" />
        </span>
        <div>
          <h3 className="text-lg font-bold text-ink">{m.syllabus.freeBookTitle}</h3>
          <p className="mt-1 leading-relaxed text-ink-muted">{m.syllabus.freeBook}</p>
        </div>
      </div>
    </Section>
  );
}

function RoundsSection({ m, locale }: { m: HomeText; locale: Locale }) {
  const r = m.rounds;
  const knockoutMethod = homeFacts.knockoutMethod === 'video' ? r.knockout.video : r.knockout.viva;
  const items = [
    {
      id: 'selection',
      title: r.selection.name,
      when: r.method(r.selection.method),
      body: r.selection.detail,
    },
    {
      id: 'knockout',
      title: r.knockout.name,
      when: r.method(knockoutMethod),
      body: r.knockout.detail(formatNumber(locale, homeFacts.knockoutQualifiers)),
    },
    {
      id: 'final',
      title: r.final.name,
      when: r.method(r.final.method),
      body: r.final.detail(formatNumber(locale, homeFacts.finalMarksPerEpisode)),
    },
  ].map((item, index) => ({ ...item, marker: formatNumber(locale, index + 1) }));
  return (
    <Section
      id="rounds"
      surface="shell"
      kicker={r.kicker}
      title={r.title}
      lead={r.lead}
      decoration={<GeometricPattern id="rounds-pattern" size={56} className="text-white/[0.05]" />}
    >
      <Timeline items={items} variant="steps" tone="dark" />
    </Section>
  );
}

function PrizesSection({ m }: { m: HomeText }) {
  const p = m.prizes;
  const others = [
    { key: 'runnerUp', Icon: Medal, ...p.runnerUp },
    { key: 'finalists', Icon: Award, ...p.finalists },
    { key: 'knockout', Icon: Star, ...p.knockout },
    { key: 'everyone', Icon: ScrollText, ...p.everyone },
  ];
  return (
    <Section id="prizes" kicker={p.kicker} title={p.title} lead={p.lead}>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <article className="relative isolate flex flex-col justify-end overflow-hidden rounded-card bg-secondary p-8 text-white shadow-card md:col-span-2 lg:col-span-1 lg:row-span-2">
          <GeometricPattern id="prize-pattern" size={48} className="text-white/[0.08]" />
          <Trophy aria-hidden="true" className="h-14 w-14 text-primary" />
          <h3 className="mt-6 text-3xl font-extrabold">{p.champion.title}</h3>
          <p className="mt-2 text-lg leading-relaxed text-white/85">{p.champion.prize}</p>
        </article>
        {others.map(({ key, Icon, title, prize }) => (
          <article key={key} className="rounded-card border border-line bg-surface p-6 shadow-card">
            <span className="flex h-11 w-11 items-center justify-center rounded-control bg-primary-soft text-primary-strong">
              <Icon aria-hidden="true" className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-lg font-bold">{title}</h3>
            <p className="mt-1 leading-relaxed text-ink-muted">{prize}</p>
          </article>
        ))}
      </div>
      <p className="mt-8 text-center text-ink-muted">{p.note}</p>
    </Section>
  );
}

function RoadmapSection({ m, locale }: { m: HomeText; locale: Locale }) {
  const items = homeFacts.roadmap.map((entry) => ({
    id: entry.key,
    title: m.roadmap[entry.key],
    when: entry.from ? formatDay(locale, entry.from, entry.to) : m.roadmap.tba,
    pending: !entry.from,
  }));
  return (
    <Section
      id="roadmap"
      surface="surface"
      kicker={m.roadmap.kicker}
      title={m.roadmap.title}
      lead={m.roadmap.lead}
    >
      <div className="mx-auto max-w-xl rounded-card border border-line bg-page p-6 md:p-8">
        <Timeline items={items} />
      </div>
    </Section>
  );
}

const TASK_ICONS = [ClipboardList, Footprints, UserPlus, ChartLine, Target, Award];

function AmbassadorSection({ m }: { m: HomeText }) {
  const a = m.ambassador;
  return (
    <Section id="ambassador" kicker={a.kicker} title={a.title} lead={a.lead}>
      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <h3 className="text-lg font-bold">{a.tasksTitle}</h3>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {a.tasks.map((task, index) => {
              const Icon = TASK_ICONS[index] ?? ClipboardList;
              return (
                <li
                  key={task}
                  className="flex items-center gap-3 rounded-control border border-line bg-surface px-4 py-3 font-medium shadow-card"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary-soft text-secondary">
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </span>
                  {task}
                </li>
              );
            })}
          </ul>
          <p className="mt-5 flex gap-2 text-sm leading-relaxed text-ink-muted">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {a.note}
          </p>
        </div>
        <div className="relative isolate flex flex-col overflow-hidden rounded-card bg-shell p-8 text-white shadow-card">
          <GeometricPattern id="ambassador-pattern" size={48} className="text-white/[0.06]" />
          <UserPlus aria-hidden="true" className="h-10 w-10 text-primary" />
          <h3 className="mt-5 text-2xl font-extrabold">{a.join}</h3>
          <p className="mt-3 flex-1 leading-relaxed text-white/80">{a.how}</p>
          <a
            href="#contact"
            className={buttonClasses({ size: 'lg', className: 'mt-6 self-start' })}
          >
            {a.cta}
          </a>
        </div>
      </div>
    </Section>
  );
}

const FAQ_HREF = {
  register: '/register',
  roadmap: '#roadmap',
  prizes: '#prizes',
  rounds: '#rounds',
  syllabus: '#syllabus',
} as const;

function FaqSection({ m }: { m: HomeText }) {
  const items = m.faq.items.map((item) => {
    const target = item.id in FAQ_HREF ? (item.id as keyof typeof FAQ_HREF) : null;
    return {
      id: `faq-${item.id}`,
      question: item.question,
      answer: (
        <>
          <p>{item.answer}</p>
          {target ? (
            <p className="mt-3">
              <Link
                href={FAQ_HREF[target]}
                className="inline-flex items-center gap-1 font-semibold text-secondary underline-offset-4 hover:underline"
              >
                {m.faq.links[target]}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </p>
          ) : null}
        </>
      ),
    };
  });
  return (
    <Section id="faq" surface="surface" kicker={m.faq.kicker} title={m.faq.title}>
      <Accordion items={items} name="home-faq" className="mx-auto max-w-3xl" />
    </Section>
  );
}

const SOCIAL_ICONS: Record<SocialLink['key'], typeof Facebook> = {
  facebook: Facebook,
  instagram: Instagram,
  youtube: Youtube,
  telegram: Send,
};

function ContactSection({ m }: { m: HomeText }) {
  const c = m.contact;
  const social = homeFacts.social.flatMap((link) => {
    const url = safeExternalUrl(link.url);
    return url ? [{ ...link, url }] : [];
  });
  return (
    <Section id="contact" surface="tint" kicker={c.kicker} title={c.title} lead={c.lead}>
      <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-7 shadow-card">
          <span className="flex h-11 w-11 items-center justify-center rounded-control bg-primary-soft text-primary-strong">
            <Mail aria-hidden="true" className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-lg font-bold">{c.email}</h3>
          {site.email ? (
            <a
              href={`mailto:${site.email}`}
              className="mt-1 block font-semibold break-all text-secondary underline-offset-4 hover:underline"
            >
              {site.email}
            </a>
          ) : (
            <p className="mt-1 text-ink-muted">{c.emailMissing}</p>
          )}
        </div>
        <div className="rounded-card border border-line bg-surface p-7 shadow-card">
          <h3 className="text-lg font-bold">{c.social}</h3>
          <ul className="mt-4 grid grid-cols-2 gap-3">
            {social.map((link) => {
              const Icon = SOCIAL_ICONS[link.key];
              return (
                <li key={link.key}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-control border border-line px-3 py-2.5 font-medium text-ink hover:bg-page"
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-secondary" />
                    {c.networks[link.key]}
                    <span className="sr-only"> {c.newTab}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Section>
  );
}
