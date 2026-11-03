import type { Locale } from '../../../i18n/index';
import { intlTag, TIME_ZONE } from '../../../i18n/config.ts';
import type { HomeFacts, RoadmapEntry } from '../../../content/home.ts';
import type { AboutFacts } from '../../../content/about.ts';

/*
 * Pure helpers of the homepage and the About page (node --test): what to show from the facts in content/, and the
 * dates in the reader's language. Nothing here reads a request, so the pages stay static.
 */

/** Midnight of a calendar day in Dhaka, so the day never shifts with the server's or the device's time zone. */
function dhakaDay(day: string): Date {
  return new Date(`${day}T00:00:00+06:00`);
}

/** A day or a period of days, e.g. "২৫ নভেম্বর, ২০২৬" or "১৯–২০ মার্চ, ২০২৭". */
export function formatDay(locale: Locale, from: string, to?: string): string {
  const format = new Intl.DateTimeFormat(intlTag(locale), {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return to ? format.formatRange(dhakaDay(from), dhakaDay(to)) : format.format(dhakaDay(from));
}

/** The registration window from the roadmap, or null when either end is not fixed yet. */
export function registrationWindow(
  roadmap: readonly RoadmapEntry[],
): { from: string; to: string } | null {
  const from = roadmap.find((entry) => entry.key === 'registrationOpens')?.from;
  const to = roadmap.find((entry) => entry.key === 'registrationCloses')?.from;
  return from && to ? { from, to } : null;
}

/** Online always; offline only once the client confirms the centres. */
export function participationModes(facts: Pick<HomeFacts, 'offline'>): Array<'online' | 'offline'> {
  return facts.offline ? ['online', 'offline'] : ['online'];
}

/** The team groups to show: none while the flag is off, and never an empty group. */
export function visibleTeam(facts: AboutFacts): Array<'advisers' | 'convenors'> {
  if (!facts.team.show) return [];
  return (['advisers', 'convenors'] as const).filter((group) => facts.team[group].length > 0);
}

/** The honorific put into a plain-text field that cannot hold a component (the meta description). */
export function withHonorificText(text: string, honorific: string): string {
  return text.split('{saw}').join(honorific);
}
