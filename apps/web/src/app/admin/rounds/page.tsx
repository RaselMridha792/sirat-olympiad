import type { Metadata } from 'next';
import { ENTRY_STATUSES, ROUND_LIMITS } from '@sirat/shared';
import { Badge, Card, PageHeader } from '@sirat/ui';
import { JuryButton } from '@/components/admin/rounds/JuryButton';
import { PromoteButton } from '@/components/admin/rounds/PromoteButton';
import { RoundEditor } from '@/components/admin/rounds/RoundEditor';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { adminRoundsMessages } from '@/i18n/messages/admin-rounds';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/rounds';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminRoundsMessages);
  return { title: m.title };
}

/**
 * Rounds and promotion for admins (core C6a, old admin/mark-controller): every round in order (at most 10) with its
 * window, jury criteria, entries by status and promotions. "Add round" appends a video or final round; "Promote"
 * previews one category's top N with the tie count and runs it after a typed confirmation.
 */
export default async function AdminRoundsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminRoundsMessages),
    getMessages(common),
    getData(params),
  ]);
  const rounds = await data.admin.listRounds();
  const juries = new Map(
    await Promise.all(
      rounds
        .filter((r) => r.type === 'video')
        .map(async (r) => [r.id, await data.admin.getRoundJury(r.id)] as const),
    ),
  );
  const n = (value: number) => formatNumber(locale, value);
  const canAdd = rounds.length < ROUND_LIMITS.maxRounds && !rounds.some((r) => r.type === 'final');

  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        actions={canAdd ? <RoundEditor locale={locale} /> : null}
      />
      <ol className="flex flex-col gap-4">
        {rounds.map((round, i) => {
          const next = rounds[i + 1];
          return (
            <li key={round.id}>
              <Card className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink-muted">
                      {m.order(n(round.sortOrder))}
                    </p>
                    <h2 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-bold text-ink">
                      {round.name}
                      <Badge tone="brand">{c.roundTypes[round.type]}</Badge>
                    </h2>
                    {round.type === 'quiz' ? null : (
                      <p className="mt-1 text-sm text-ink-muted">
                        {m.window}:{' '}
                        {round.opensAt && round.closesAt
                          ? m.windowRange(
                              formatDateTime(locale, round.opensAt),
                              formatDateTime(locale, round.closesAt),
                            )
                          : m.noWindow}
                      </p>
                    )}
                    {round.criteria ? (
                      <p className="mt-1 text-sm text-ink-muted">
                        {m.criteria(n(round.criteria.length))}
                        {round.scored ? ` · ${m.frozen}` : null}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <RoundEditor locale={locale} round={round} />
                    {juries.get(round.id) ? (
                      <JuryButton locale={locale} jury={juries.get(round.id)!} />
                    ) : null}
                    {next && round.type !== 'final' ? (
                      <PromoteButton
                        locale={locale}
                        round={{ id: round.id, name: round.name }}
                        nextName={next.name}
                      />
                    ) : null}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{m.entries}</h3>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {ENTRY_STATUSES.map((status) => (
                      <li
                        key={status}
                        className="rounded-control border border-line px-3 py-1 text-sm text-ink"
                      >
                        {c.entryStatus[status]}:{' '}
                        <span className="font-semibold tabular-nums">
                          {n(round.entries[status])}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {round.type === 'final' ? null : (
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{m.promotions}</h3>
                    {round.promotions.length === 0 ? (
                      <p className="mt-1 text-sm text-ink-muted">{m.noPromotions}</p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-1 text-sm text-ink">
                        {round.promotions.map((p) => (
                          <li key={p.id}>
                            {m.promotion(
                              c.categories[p.category],
                              n(p.promoted),
                              n(p.topN),
                              n(p.eliminated),
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ol>
    </>
  );
}
