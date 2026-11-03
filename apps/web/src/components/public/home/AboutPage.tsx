import { Avatar, Section } from '@sirat/ui';
import { aboutFacts } from '@/content/about';
import type { Locale } from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { aboutMessages } from '@/i18n/messages/about';
import { homeMessages } from '@/i18n/messages/home';
import { PublicShell } from '../PublicShell';
import { visibleTeam } from './home-view';
import { FinalCta, GoalsSection, HighlightsSection, IntroSection, PageHero } from './sections';

/*
 * অলিম্পিয়াড পরিচিতি (owner, 2026-11-03). The intro, goals, quote and numbers are the homepage's own (one source);
 * the purpose and the five goals are this page's. The team bands render only when content/about.ts turns them on.
 * Static: no cookie, header or API read.
 */
export function AboutPage({ locale }: { locale: Locale }) {
  const m = pick(homeMessages, locale);
  const a = pick(aboutMessages, locale);
  const team = visibleTeam(aboutFacts);
  return (
    <PublicShell locale={locale} page="about" bleed>
      <PageHero kicker={a.hero.kicker} title={a.hero.title} lead={a.hero.lead} />
      <IntroSection m={m} />
      <GoalsSection m={m} locale={locale}>
        <div className="mx-auto mt-12 max-w-3xl">
          <h3 className="text-center text-xl font-extrabold">{a.fiveGoals.title}</h3>
          <ol className="mt-6 flex flex-col gap-3">
            {a.fiveGoals.items.map((goal, index) => (
              <li
                key={goal}
                className="flex items-center gap-4 rounded-control border border-line bg-page px-5 py-4"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-base font-extrabold text-white">
                  {formatNumber(locale, index + 1)}
                </span>
                <span className="leading-relaxed font-medium">{goal}</span>
              </li>
            ))}
          </ol>
        </div>
      </GoalsSection>
      <HighlightsSection m={m} />
      {team.length ? (
        <Section id="team" kicker={a.team.kicker} title={a.team.title}>
          <div className="flex flex-col gap-12">
            {team.map((group) => (
              <div key={group}>
                <h3 className="text-center text-xl font-extrabold">{a.team[group]}</h3>
                <p className="mt-2 text-center text-ink-muted">
                  {group === 'advisers' ? a.team.advisersLead : a.team.convenorsLead}
                </p>
                <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  {aboutFacts.team[group].map((member) => (
                    <li
                      key={`${member.name}-${member.role}`}
                      className="flex flex-col items-center rounded-card border border-line bg-surface p-6 text-center shadow-card"
                    >
                      <Avatar name={member.name} size="lg" />
                      <p className="mt-4 font-bold">{member.name}</p>
                      <p className="mt-1 text-sm text-ink-muted">{member.role}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      ) : null}
      <FinalCta m={m} />
    </PublicShell>
  );
}
