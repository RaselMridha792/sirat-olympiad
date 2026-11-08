import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye, Search, UsersRound } from 'lucide-react';
import {
  Badge,
  buttonClasses,
  DataTable,
  EmptyState,
  LinkPagination,
  PageHeader,
  SearchBox,
} from '@sirat/ui';
import { RenameTeamButton } from '@/components/admin/RenameTeamButton';
import { DemoBadge } from '@/components/admin/demo/DemoBadge';
import { LinkPendingIcon } from '@/components/LinkPendingIcon';
import { RouteDialog } from '@/components/RouteDialog';
import { getData } from '@/data';
import { hrefWith, parseId, parsePageQuery, totalPages, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDate, formatNumber } from '@/i18n/format';
import { adminTeamsMessages } from '@/i18n/messages/admin-teams';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/teams';
const PAGE_SIZE = 20;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminTeamsMessages);
  return { title: m.title };
}

/**
 * Ambassador teams for admins (core C5b-3): search by name, the owner, the member count and whether the team still
 * takes members; the detail dialog (`?team=`) lists the members with their emails and offers a rename (moderation,
 * audited with a reason). No dissolve in v1.
 */
export default async function AdminTeamsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminTeamsMessages),
    getMessages(common),
    getData(params),
  ]);
  const query = parsePageQuery(params, PAGE_SIZE);
  const teamId = parseId(params.team);
  const [list, detail] = await Promise.all([
    data.admin.listTeams(query),
    teamId ? data.admin.getTeam(teamId) : null,
  ]);
  const pages = totalPages(list.total, list.pageSize);
  const n = (value: number) => formatNumber(locale, value);
  const here = { q: query.q, page: list.page };

  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={m.subtitle(n(list.total))}
        actions={
          <SearchBox
            id="team-search"
            action={PATH}
            defaultValue={query.q}
            label={m.search.label}
            placeholder={m.search.placeholder}
            submitLabel={c.search.submit}
            icon={<Search aria-hidden="true" size={16} />}
          />
        }
      />
      {list.items.length === 0 ? (
        <EmptyState
          icon={<UsersRound aria-hidden="true" size={24} />}
          title={m.empty.title}
          description={query.q ? m.empty.filtered : m.empty.none}
        />
      ) : (
        <DataTable
          caption={m.table.caption}
          rows={list.items}
          rowKey={(t) => t.id}
          columns={[
            {
              key: 'team',
              header: m.table.team,
              render: (t) => (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{t.name}</span>
                  <DemoBadge demo={t.demo} locale={locale} />
                </span>
              ),
            },
            { key: 'owner', header: m.table.owner, render: (t) => t.owner.name },
            {
              key: 'members',
              header: m.table.members,
              className: 'px-5 py-4 text-sm tabular-nums text-ink',
              render: (t) => n(t.memberCount),
            },
            {
              key: 'state',
              header: m.table.state,
              render: (t) => (
                <Badge tone={t.open ? 'success' : 'neutral'}>{t.open ? m.open : m.closed}</Badge>
              ),
            },
            {
              key: 'created',
              header: m.table.created,
              className: 'whitespace-nowrap px-5 py-4 text-sm text-ink-muted',
              render: (t) => formatDate(locale, t.createdAt),
            },
            {
              key: 'details',
              header: m.table.details,
              headerClassName: 'text-right',
              className: 'px-5 py-3 text-right',
              render: (t) => (
                <Link
                  href={hrefWith(PATH, { ...here, team: t.id })}
                  replace
                  scroll={false}
                  aria-label={m.viewDetails(t.name)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-secondary-soft hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                >
                  <LinkPendingIcon size={18}>
                    <Eye aria-hidden="true" size={18} />
                  </LinkPendingIcon>
                </Link>
              ),
            },
          ]}
        />
      )}
      <LinkPagination
        page={list.page}
        totalPages={pages}
        linkAs={Link}
        hrefFor={(page) => hrefWith(PATH, { q: query.q, page })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(n(list.page), n(pages))}
      />
      {teamId ? (
        <RouteDialog
          key={teamId}
          title={detail?.name ?? m.detail.notFoundTitle}
          closeLabel={c.states.close}
          closeHref={hrefWith(PATH, here)}
        >
          {detail ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink">
                  {m.table.owner}: <span className="font-semibold">{detail.owner.name}</span>
                </p>
                <RenameTeamButton
                  locale={locale}
                  teamId={detail.id}
                  name={detail.name}
                  updatedAt={detail.updatedAt}
                />
              </div>
              {detail.open ? null : <p className="text-sm text-ink-muted">{m.closedNote}</p>}
              <div>
                <h3 className="text-sm font-semibold text-ink">{m.detail.members}</h3>
                <ul className="mt-2 flex flex-col gap-1">
                  {detail.members.map((member) => (
                    <li
                      key={member.userId}
                      className="flex flex-wrap justify-between gap-2 text-sm"
                    >
                      <span className="text-ink">
                        {member.name} <span className="text-ink-muted">· {member.email}</span>
                      </span>
                      <span className="text-xs text-ink-muted">
                        {m.detail.joined} {formatDate(locale, member.joinedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">{m.detail.notFoundText}</p>
          )}
        </RouteDialog>
      ) : null}
    </>
  );
}
