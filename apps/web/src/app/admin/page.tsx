import type { Metadata } from 'next';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import {
  Activity,
  Award,
  ChartLine,
  CircleCheckBig,
  Clock,
  Layers,
  RefreshCw,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { AdminStats } from '@sirat/shared';
import { Card, EmptyState, PageHeader, StatCard } from '@sirat/ui';
import { BarList, LineChart, type BarListItem, type LineChartPoint } from '@sirat/ui/charts';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import type { Locale } from '@/i18n';
import { common } from '@/i18n/common';
import { formatDate, formatDateTime, formatNumber } from '@/i18n/format';
import { adminHomeMessages } from '@/i18n/messages/admin-home';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminHomeMessages);
  return { title: m.title };
}

type Totals = AdminStats['totals'];
type Tone = NonNullable<ComponentProps<typeof StatCard>['tone']>;

/** KPI cards: the old three (enrolment, 2nd round, finalists) plus payments and exam attempts. */
const KPIS: ReadonlyArray<{ key: keyof Totals; tone: Tone; Icon: LucideIcon }> = [
  { key: 'registered', tone: 'info', Icon: Users },
  { key: 'paid', tone: 'success', Icon: Wallet },
  { key: 'pendingPayments', tone: 'warning', Icon: Clock },
  { key: 'activeAttempts', tone: 'brand', Icon: Activity },
  { key: 'submittedAttempts', tone: 'secondary', Icon: CircleCheckBig },
  { key: 'secondRound', tone: 'brand', Icon: Layers },
  { key: 'finalists', tone: 'secondary', Icon: Award },
];

/** Funnel stages in order, each shown as a share of everyone registered (replaces the old donut). */
const PIPELINE: ReadonlyArray<keyof Totals> = [
  'registered',
  'paid',
  'submittedAttempts',
  'secondRound',
  'finalists',
];

const DHAKA_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A Dhaka calendar day (YYYY-MM-DD) as a local date; anything unexpected is shown as it came. */
function dhakaDay(locale: Locale, date: string): string {
  const iso = `${date}T00:00:00+06:00`;
  return DHAKA_DAY.test(date) && !Number.isNaN(Date.parse(iso)) ? formatDate(locale, iso) : date;
}

/** Percent for display: whole numbers from 10 %, finer below so a small stage never reads as 0. */
function percentOf(part: number, whole: number): number {
  const raw = (part / whole) * 100;
  if (raw >= 10) return Math.round(raw);
  if (raw >= 1) return Math.round(raw * 10) / 10;
  return raw > 0 ? Math.max(0.01, Math.round(raw * 100) / 100) : 0;
}

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAccess('/admin');
  if (user.role === 'jury') {
    // No statistics call: /admin/stats is for admins and managers.
    const { m } = await getMessages(adminHomeMessages);
    return (
      <>
        <PageHeader title={m.jury.title} />
        <EmptyState title={m.jury.body} />
      </>
    );
  }
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminHomeMessages),
    getMessages(common),
    getData(params),
  ]);
  // A cached aggregate (refreshed by a job on the server): `asOf` says how fresh it is.
  const stats = await data.admin.getStats();
  const { totals } = stats;

  const num = (value: number) => formatNumber(locale, value);
  const share = (part: number, whole: number) =>
    whole > 0 ? m.percent(num(percentOf(part, whole))) : undefined;
  const summarize = (items: BarListItem[]) =>
    items
      .map((item) =>
        item.shareLabel
          ? m.part(item.label, item.valueLabel, item.shareLabel)
          : m.partWithoutShare(item.label, item.valueLabel),
      )
      .join(', ');
  const updated = Number.isNaN(Date.parse(stats.asOf))
    ? null
    : m.hero.updated(formatDateTime(locale, stats.asOf));

  // Registrations per day: one axis label a week, counted back from the latest day.
  const daily = stats.registrationsDaily;
  const lastDay = daily.length - 1;
  const points: LineChartPoint[] = daily.map((entry, index) => {
    const label = dhakaDay(locale, entry.date);
    return { label, value: entry.count, tick: (lastDay - index) % 7 === 0 ? label : undefined };
  });
  const periodTotal = daily.reduce((sum, entry) => sum + entry.count, 0);
  const peak = daily.reduce<(typeof daily)[number] | undefined>(
    (best, entry) => (!best || entry.count > best.count ? entry : best),
    undefined,
  );
  const latest = daily[lastDay];
  const registrationsTitle = m.registrations.title(num(daily.length));
  const registrationsSummary =
    peak && latest && periodTotal > 0
      ? m.registrations.summary(
          num(daily.length),
          num(periodTotal),
          num(peak.count),
          dhakaDay(locale, peak.date),
          num(latest.count),
        )
      : m.registrations.empty;

  const categoryTotal = stats.byCategory.reduce((sum, entry) => sum + entry.count, 0);
  const categories: BarListItem[] = stats.byCategory.map(({ category, count }) => ({
    key: category,
    label: c.categories[category],
    value: count,
    valueLabel: num(count),
    shareLabel: share(count, categoryTotal),
  }));

  const stages: BarListItem[] = PIPELINE.map((key) => ({
    key,
    label: m.kpi[key],
    value: totals[key],
    valueLabel: num(totals[key]),
    shareLabel: share(totals[key], totals.registered),
  }));

  return (
    <>
      <section
        aria-labelledby="admin-overview-title"
        className="relative overflow-hidden rounded-[2rem] bg-shell px-6 py-8 shadow-card md:px-10 md:py-10"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/15 blur-2xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 left-1/4 h-56 w-56 rounded-full bg-white/5"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-10 right-1/3 h-28 w-28 rounded-full border border-white/10"
        />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1
              id="admin-overview-title"
              className="text-2xl font-extrabold tracking-tight text-white md:text-3xl"
            >
              {m.hero.title}
            </h1>
            <p className="mt-1 text-sm font-medium text-white/70">{m.hero.subtitle}</p>
            {updated ? (
              <p className="mt-4 flex items-center gap-1.5 text-xs text-white/60">
                <Clock size={14} aria-hidden="true" className="shrink-0" />
                {updated}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="inline-flex items-center gap-2 rounded-control border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-safe:transition-colors"
            >
              <RefreshCw size={16} aria-hidden="true" />
              {m.hero.refresh}
            </Link>
            <span
              aria-hidden="true"
              className="hidden rounded-2xl border border-primary/20 bg-primary/10 p-4 text-primary md:block"
            >
              <ChartLine size={26} />
            </span>
          </div>
        </div>
      </section>

      <section aria-labelledby="admin-kpi-title" className="mt-6">
        <h2 id="admin-kpi-title" className="sr-only">
          {m.kpiHeading}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {KPIS.map(({ key, tone, Icon }) => (
            <StatCard
              key={key}
              title={m.kpi[key]}
              value={num(totals[key])}
              tone={tone}
              icon={<Icon size={24} aria-hidden="true" />}
            />
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-ink">{registrationsTitle}</h2>
          <p className="mt-1 text-sm text-ink-muted">{m.registrations.subtitle}</p>
          <LineChart
            className="mt-6"
            points={points}
            summary={registrationsSummary}
            caption={registrationsTitle}
            columns={{ label: m.registrations.columns.day, value: m.registrations.columns.count }}
            formatValue={num}
            emptyLabel={m.registrations.empty}
            dataLabel={m.registrations.dataLabel}
          />
        </Card>

        <Card className="flex min-w-0 flex-col">
          <h2 className="text-lg font-bold tracking-tight text-ink">{m.byCategory.title}</h2>
          <p className="mt-1 text-sm text-ink-muted">{m.byCategory.subtitle}</p>
          <BarList
            className="mt-6"
            items={categories}
            max={categoryTotal}
            summary={
              categoryTotal > 0 ? m.byCategory.summary(summarize(categories)) : m.byCategory.empty
            }
            caption={m.byCategory.title}
            columns={{
              label: m.byCategory.columns.category,
              value: m.byCategory.columns.count,
              share: m.byCategory.columns.share,
            }}
            emptyLabel={m.byCategory.empty}
          />
          <div className="mt-auto pt-6">
            <p className="border-t border-line pt-4 text-sm text-ink-muted">
              {m.byCategory.total(num(categoryTotal))}
            </p>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="text-lg font-bold tracking-tight text-ink">{m.pipeline.title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{m.pipeline.subtitle}</p>
        <BarList
          className="mt-6"
          tone="ordinal"
          items={stages}
          max={totals.registered}
          summary={totals.registered > 0 ? m.pipeline.summary(summarize(stages)) : m.pipeline.empty}
          caption={m.pipeline.title}
          columns={{
            label: m.pipeline.columns.stage,
            value: m.pipeline.columns.count,
            share: m.pipeline.columns.share,
          }}
          emptyLabel={m.pipeline.empty}
        />
      </Card>
    </>
  );
}
