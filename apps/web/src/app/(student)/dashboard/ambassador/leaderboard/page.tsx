import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Medal, Trophy } from 'lucide-react';
import { Badge, DataTable, EmptyState, LinkPagination, PageHeader } from '@sirat/ui';
import { rankTone } from '@/components/status';
import { getData } from '@/data';
import { isRoleBehind } from '@/data/http/ambassador';
import { hrefWith, parsePageQuery, totalPages, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { ambassadorMessages } from '@/i18n/messages/ambassador';
import { getMessages } from '@/i18n/server';
import { refreshUrl, requireAccess } from '@/lib/session';

const PATH = '/dashboard/ambassador/leaderboard';
const PAGE_SIZE = 20;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(ambassadorMessages);
  return { title: m.board.title };
}

/**
 * The ambassador leaderboard (core A4): the ambassadors of the caller's side by points, ranked on the server (equal
 * points share a place) and cached there for up to a minute. Name, institution, points and rank only; the caller's
 * own row is marked and their place is shown even when it is on another page.
 */
export default async function AmbassadorLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(ambassadorMessages),
    getMessages(common),
    getData(params),
  ]);
  const query = parsePageQuery(params, PAGE_SIZE);
  const board = await data.student
    .getAmbassadorLeaderboard({ page: query.page, pageSize: query.pageSize })
    .catch(async (error: unknown) => {
      // Just approved: the token still carries the old role, so renew it and come back (as the panel does).
      if (isRoleBehind(error)) redirect(await refreshUrl());
      throw error;
    });
  const n = (value: number) => formatNumber(locale, value);
  const pages = totalPages(board.total, board.pageSize);
  // Rows carry no id (by design); the position in the ranking is unique, places and names may repeat.
  const rows = board.items.map((row, index) => ({
    ...row,
    position: (board.page - 1) * board.pageSize + index,
  }));

  return (
    <>
      <PageHeader
        title={m.board.title}
        subtitle={m.board.subtitle(formatDateTime(locale, board.asOf))}
        actions={
          <Link
            href="/dashboard/ambassador"
            className="inline-flex min-h-6 items-center gap-2 text-sm font-semibold text-secondary hover:underline"
          >
            <ArrowLeft aria-hidden="true" size={16} />
            {m.board.back}
          </Link>
        }
      />

      <p
        className="mb-6 flex items-center gap-3 rounded-xl border border-line bg-surface p-4 font-semibold text-ink shadow-card"
        aria-live="polite"
      >
        <Medal aria-hidden="true" size={22} className="shrink-0 text-accent-strong" />
        {board.me ? m.board.mine(n(board.me.rank), n(board.me.points)) : m.board.notRanked}
      </p>

      {board.total === 0 ? (
        <EmptyState
          icon={<Trophy size={28} />}
          title={m.board.empty.title}
          description={m.board.empty.text}
        />
      ) : (
        <>
          <DataTable
            caption={m.board.caption}
            rows={rows}
            rowKey={(r) => String(r.position)}
            columns={[
              {
                key: 'place',
                header: m.board.columns.place,
                render: (r) => (
                  <span className="whitespace-nowrap text-lg font-black tabular-nums text-ink-muted">
                    {`#${n(r.rank)}`}
                  </span>
                ),
              },
              {
                key: 'name',
                header: m.board.columns.name,
                render: (r) => (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-ink">{r.name}</span>
                    {r.isMe ? <Badge tone="brand">{m.board.you}</Badge> : null}
                  </span>
                ),
              },
              {
                key: 'institution',
                header: m.board.columns.institution,
                render: (r) =>
                  r.institution ? (
                    <span className="font-semibold text-ink">{r.institution}</span>
                  ) : (
                    <span className="text-ink-muted">{c.notProvided}</span>
                  ),
              },
              {
                key: 'points',
                header: m.board.columns.points,
                className: 'px-5 py-4 text-sm font-bold tabular-nums text-ink',
                render: (r) => n(r.points),
              },
              {
                key: 'tier',
                header: m.board.columns.tier,
                render: (r) =>
                  r.tier ? (
                    <Badge tone={rankTone(r.tier)}>{r.tier}</Badge>
                  ) : (
                    <span className="text-ink-muted">{m.stats.noRank}</span>
                  ),
              },
            ]}
          />
          <LinkPagination
            page={board.page}
            totalPages={pages}
            linkAs={Link}
            hrefFor={(page) => hrefWith(PATH, { page })}
            label={c.pagination.label}
            prevLabel={c.pagination.prev}
            nextLabel={c.pagination.next}
            summary={c.pagination.summary(n(board.page), n(pages))}
          />
        </>
      )}
    </>
  );
}
