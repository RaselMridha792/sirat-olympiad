import type { Metadata } from 'next';
import Link from 'next/link';
import { Gavel } from 'lucide-react';
import { isAllowedVideoUrl } from '@sirat/shared';
import { DataTable, EmptyState, LinkPagination, PageHeader, Tabs } from '@sirat/ui';
import { ScoreButton } from '@/components/jury/ScoreButton';
import { getData } from '@/data';
import {
  hrefWith,
  parseEnum,
  parseId,
  parsePage,
  totalPages,
  type SearchParams,
} from '@/data/query';
import { common } from '@/i18n/common';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { juryMessages } from '@/i18n/messages/jury';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/jury';
const PAGE_SIZE = 20;
const STATUSES = ['pending', 'evaluated'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(juryMessages);
  return { title: m.title };
}

/**
 * The jury's work (core C6b, old admin/video-evaluation): the judge's video rounds, the sent videos of their
 * categories after the close, blind (an entry number, never a name), "To score" and "Scored", and the score dialog.
 * A video opens in a new tab only for an allowed host (lead): never embedded.
 */
export default async function JuryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(juryMessages),
    getMessages(common),
    getData(params),
  ]);
  const n = (value: number) => formatNumber(locale, value);
  const rounds = await data.admin.listJuryRounds();
  const header = <PageHeader title={m.title} subtitle={m.subtitle} />;
  if (rounds.length === 0)
    return (
      <>
        {header}
        <EmptyState
          icon={<Gavel aria-hidden="true" size={24} />}
          title={m.noRounds.title}
          description={m.noRounds.text}
        />
      </>
    );

  const wanted = parseId(params.round);
  const round = rounds.find((r) => r.id === wanted) ?? rounds[0]!;
  const status = parseEnum(params.status, STATUSES) ?? 'pending';
  const page = parsePage(params.page);
  const list = round.scoringOpen
    ? await data.admin.listJuryEntries({ round: round.id, status, page, pageSize: PAGE_SIZE })
    : null;
  const here = { round: round.id, status };

  return (
    <>
      {header}
      {rounds.length > 1 ? (
        <Tabs
          label={m.title}
          linkAs={Link}
          activeKey={round.id}
          items={rounds.map((r) => ({
            key: r.id,
            label: r.name,
            href: hrefWith(PATH, { round: r.id }),
          }))}
        />
      ) : null}
      <p className="mb-4 text-sm text-ink-muted">
        {round.name} · {round.categories.map((k) => c.categories[k]).join(', ')} ·{' '}
        {m.counts(n(round.pending), n(round.evaluated))}
      </p>
      {!list ? (
        <EmptyState
          icon={<Gavel aria-hidden="true" size={24} />}
          title={round.name}
          description={
            round.closesAt ? m.notYet(formatDateTime(locale, round.closesAt)) : m.errors.window_open
          }
        />
      ) : (
        <>
          <Tabs
            label={m.title}
            linkAs={Link}
            activeKey={status}
            items={STATUSES.map((s) => ({
              key: s,
              label: m.tabs[s],
              href: hrefWith(PATH, { round: round.id, status: s }),
            }))}
          />
          {list.items.length === 0 ? (
            <EmptyState icon={<Gavel aria-hidden="true" size={24} />} title={m.empty[status]} />
          ) : (
            <DataTable
              caption={m.table.caption}
              rows={list.items}
              rowKey={(e) => e.entryId}
              columns={[
                {
                  key: 'entry',
                  header: m.table.entry,
                  render: (e) => <span className="font-mono font-semibold text-ink">{e.code}</span>,
                },
                {
                  key: 'category',
                  header: m.table.category,
                  render: (e) => c.categories[e.category],
                },
                {
                  key: 'video',
                  header: m.table.video,
                  render: (e) =>
                    isAllowedVideoUrl(e.videoUrl) ? (
                      <a
                        href={e.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-secondary hover:underline"
                      >
                        {m.openVideo}
                      </a>
                    ) : (
                      <span className="text-ink-muted">{m.videoNotLinked}</span>
                    ),
                },
                {
                  key: 'sent',
                  header: m.table.sent,
                  className: 'whitespace-nowrap px-5 py-4 text-sm text-ink-muted',
                  render: (e) => formatDateTime(locale, e.videoSubmittedAt),
                },
                {
                  key: 'mine',
                  header: m.table.mine,
                  className: 'px-5 py-4 text-sm tabular-nums text-ink',
                  render: (e) => (e.myScore ? n(e.myScore.total) : '–'),
                },
                {
                  key: 'action',
                  header: m.table.action,
                  headerClassName: 'text-right',
                  className: 'px-5 py-3 text-right',
                  render: (e) => (
                    <ScoreButton
                      locale={locale}
                      entryId={e.entryId}
                      code={e.code}
                      criteria={round.criteria}
                      previous={e.myScore?.criteria ?? null}
                    />
                  ),
                },
              ]}
            />
          )}
          <LinkPagination
            page={list.page}
            totalPages={totalPages(list.total, list.pageSize)}
            linkAs={Link}
            hrefFor={(p) => hrefWith(PATH, { ...here, page: p })}
            label={c.pagination.label}
            prevLabel={c.pagination.prev}
            nextLabel={c.pagination.next}
            summary={c.pagination.summary(n(list.page), n(totalPages(list.total, list.pageSize)))}
          />
        </>
      )}
    </>
  );
}
