import type { Metadata } from 'next';
import { ClipboardList, Medal, Star, UserPlus, Users, UsersRound } from 'lucide-react';
import { Badge, Card, DataTable, EmptyState, StatCard } from '@sirat/ui';
import { CopyCode } from '@/components/ambassador/CopyCode';
import { rankStanding } from '@/components/ambassador/rank';
import { rankTone, taskStatusTone } from '@/components/status';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDate, formatNumber } from '@/i18n/format';
import { ambassadorMessages } from '@/i18n/messages/ambassador';
import { getMessages } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(ambassadorMessages);
  return { title: m.title };
}

/**
 * Ambassador panel: promo code, referral count, points, rank, team, tasks and recent referrals,
 * all computed by the server (referrals counted from rows, points summed from the ledger).
 * Read-only: codes are assigned by an admin (the old "set your own code" input is gone).
 */
export default async function AmbassadorPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(ambassadorMessages),
    getMessages(common),
    getData(params),
  ]);
  const amb = await data.student.getAmbassador();

  const n = (value: number) => formatNumber(locale, value);
  // Three distinct cases: climbing (incl. a new ambassador at 0 points), top rank, no tiers/data.
  const standing = rankStanding(amb.points, amb.rank);
  const currentName = standing.kind === 'unranked' ? null : standing.current;
  const rankHint =
    standing.kind === 'climbing'
      ? m.stats.toNext(n(standing.toNext), standing.next, standing.toNext)
      : standing.kind === 'top'
        ? m.stats.topRank
        : m.stats.unranked;
  const pointsText = m.progress.points(n(amb.points), amb.points);
  // The bar is measured inside the tier (floor to target), so its text names both ends too.
  const progressText =
    standing.kind === 'climbing'
      ? m.progress.value(pointsText, n(standing.floor), n(standing.target))
      : m.progress.topValue(n(amb.points));
  const bar =
    standing.kind === 'climbing'
      ? {
          min: standing.floor,
          max: standing.target,
          now: Math.min(Math.max(amb.points, standing.floor), standing.target),
          percent: standing.percent,
        }
      : { min: 0, max: 100, now: 100, percent: 100 };
  // Referral rows carry no id; their position in this short, server-ordered list is unique.
  const referrals = amb.recentReferrals.map((row, position) => ({ ...row, position }));

  return (
    <>
      <section
        aria-labelledby="ambassador-title"
        className="relative overflow-hidden rounded-[2.5rem] bg-shell p-6 text-white shadow-card sm:p-8"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-white/5"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 left-1/4 h-56 w-56 rounded-full bg-white/5"
        />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 id="ambassador-title" className="text-3xl font-black tracking-tight">
              {m.title}
            </h1>
            <p className="mt-2 text-white/70">{m.intro}</p>
          </div>
          <div className="w-full rounded-3xl border border-white/10 bg-white/10 p-6 text-center backdrop-blur-md md:w-auto md:min-w-72">
            {amb.promoCode ? (
              <>
                <p className="text-xs font-bold uppercase tracking-wider text-white/70">
                  {m.code.label}
                </p>
                <p className="mt-2 select-all break-all font-mono text-3xl font-black tracking-widest">
                  {amb.promoCode}
                </p>
                <div className="mt-4">
                  <CopyCode
                    code={amb.promoCode}
                    label={m.code.copy}
                    copiedLabel={m.code.copied}
                    failedLabel={m.code.copyFailed}
                  />
                </div>
                <p className="mt-2 text-xs text-white/70">{m.code.hint}</p>
              </>
            ) : (
              <p className="text-sm text-white/80">{m.code.pending}</p>
            )}
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title={m.stats.referrals}
          value={n(amb.referralCount)}
          hint={m.stats.referralsHint}
          tone="success"
          icon={<Users size={26} />}
        />
        <StatCard
          title={m.stats.points}
          value={n(amb.points)}
          tone="brand"
          icon={<Star size={26} />}
        />
        <div className="grid sm:col-span-2 lg:col-span-1">
          <StatCard
            title={m.stats.rank}
            value={currentName ?? m.stats.noRank}
            hint={rankHint}
            tone="warning"
            icon={<Medal size={26} />}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {standing.kind !== 'unranked' ? (
          <Card className="lg:col-span-2">
            <h2 className="text-base font-black text-ink">{m.progress.title}</h2>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-ink-muted">{m.progress.current}</p>
                <p className="mt-2">
                  {currentName ? (
                    <Badge tone={rankTone(currentName)}>{currentName}</Badge>
                  ) : (
                    <span className="text-sm font-semibold text-ink-muted">{m.stats.noRank}</span>
                  )}
                </p>
              </div>
              {standing.kind === 'climbing' ? (
                <div className="text-right">
                  <p className="text-xs font-semibold text-ink-muted">{m.progress.next}</p>
                  <p className="mt-2">
                    <Badge tone={rankTone(standing.next)}>{standing.next}</Badge>
                  </p>
                </div>
              ) : null}
            </div>
            <div
              role="progressbar"
              aria-label={
                standing.kind === 'climbing' ? m.progress.label(standing.next) : m.progress.topLabel
              }
              aria-valuemin={bar.min}
              aria-valuemax={bar.max}
              aria-valuenow={bar.now}
              aria-valuetext={progressText}
              className="mt-4 h-3 w-full overflow-hidden rounded-full bg-line"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${bar.percent}%` }}
              />
            </div>
            {standing.kind === 'climbing' ? (
              // Tier bounds under the two ends of the bar. Hidden from screen readers only
              // because the progressbar already gives them (aria-valuemin/max and valuetext).
              <div
                aria-hidden="true"
                className="mt-2 flex items-baseline justify-between gap-3 tabular-nums"
              >
                <span className="text-xs font-semibold text-ink-muted">{n(standing.floor)}</span>
                <span className="text-sm font-semibold text-ink">{pointsText}</span>
                <span className="text-xs font-semibold text-ink-muted">{n(standing.target)}</span>
              </div>
            ) : (
              <p className="mt-2 text-sm font-semibold text-ink-muted">{progressText}</p>
            )}
          </Card>
        ) : null}

        <Card className={standing.kind !== 'unranked' ? undefined : 'lg:col-span-3'}>
          <h2 className="text-base font-black text-ink">{m.team.title}</h2>
          {amb.team ? (
            <div className="mt-4 flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-secondary-soft text-secondary"
              >
                <UsersRound size={24} />
              </span>
              <div className="min-w-0">
                <p className="break-words text-lg font-black text-ink">{amb.team.name}</p>
                <p className="text-sm text-ink-muted">
                  {m.team.members(n(amb.team.memberCount), amb.team.memberCount)}
                </p>
                {amb.team.isOwner ? (
                  <div className="mt-2">
                    <Badge tone="brand">{m.team.owner}</Badge>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">{m.team.none}</p>
          )}
        </Card>
      </div>

      <section aria-labelledby="ambassador-tasks" className="mt-8">
        <h2 id="ambassador-tasks" className="mb-4 text-lg font-black text-ink">
          {m.tasks.title}
        </h2>
        {amb.tasks.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={28} />}
            title={m.tasks.empty}
            description={m.tasks.emptyHint}
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {amb.tasks.map((task) => (
              <li key={task.id} className="flex">
                <Card className="flex w-full flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-bold text-ink">{task.title}</h3>
                    <span className="shrink-0">
                      <Badge tone={taskStatusTone[task.status]}>{c.taskStatus[task.status]}</Badge>
                    </span>
                  </div>
                  <p className="mt-2 flex-1 text-sm text-ink-muted">{task.description}</p>
                  <p className="mt-4 text-sm font-black text-secondary">
                    {m.tasks.points(n(task.points), task.points)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ambassador-referrals" className="mt-8">
        <h2 id="ambassador-referrals" className="mb-4 text-lg font-black text-ink">
          {m.referrals.title}
        </h2>
        {referrals.length === 0 ? (
          <EmptyState
            icon={<UserPlus size={28} />}
            title={m.referrals.empty}
            description={amb.promoCode ? m.referrals.emptyHint : undefined}
          />
        ) : (
          <DataTable
            caption={m.referrals.caption}
            rows={referrals}
            rowKey={(r) => String(r.position)}
            columns={[
              {
                key: 'name',
                header: m.referrals.columns.name,
                render: (r) => <span className="font-bold text-ink">{r.name}</span>,
              },
              {
                key: 'institution',
                header: m.referrals.columns.institution,
                render: (r) =>
                  r.institution ?? <span className="text-ink-muted">{c.notProvided}</span>,
              },
              {
                key: 'joined',
                header: m.referrals.columns.joined,
                headerClassName: 'text-right',
                className: 'whitespace-nowrap px-5 py-4 text-right text-sm text-ink-muted',
                render: (r) => formatDate(locale, r.createdAt),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
