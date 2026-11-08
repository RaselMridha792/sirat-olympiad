import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, Search } from 'lucide-react';
import { CERTIFICATE_TYPES } from '@sirat/shared';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  LinkPagination,
  PageHeader,
  SearchBox,
} from '@sirat/ui';
import { IssueForm } from '@/components/certificates/IssueForm';
import { RevokeButton } from '@/components/certificates/RevokeButton';
import { DemoBadge } from '@/components/admin/demo/DemoBadge';
import { getData } from '@/data';
import { hrefWith, parseEnum, parsePageQuery, totalPages, type SearchParams } from '@/data/query';
import { common } from '@/i18n/common';
import { formatDate, formatNumber } from '@/i18n/format';
import { certificatesMessages } from '@/i18n/messages/certificates';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/certificates';
const PAGE_SIZE = 20;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(certificatesMessages);
  return { title: m.admin.title };
}

/**
 * Certificates for admins (core C6c-1): ask for an issue run (participation, promotion, winners), then the list with
 * search by name or number, and a revoke with a reason. Nothing is ever deleted.
 */
export default async function AdminCertificatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(certificatesMessages),
    getMessages(common),
    getData(params),
  ]);
  const query = parsePageQuery(params, PAGE_SIZE);
  const type = parseEnum(params.type, CERTIFICATE_TYPES);
  const [rounds, list] = await Promise.all([
    data.admin.listRounds(),
    data.admin.listCertificates({ ...query, type }),
  ]);
  const pages = totalPages(list.total, list.pageSize);
  const n = (value: number) => formatNumber(locale, value);
  const here = { q: query.q, type };

  return (
    <>
      <PageHeader
        title={m.admin.title}
        subtitle={m.admin.subtitle(n(list.total))}
        actions={
          <SearchBox
            id="certificate-search"
            action={PATH}
            defaultValue={query.q}
            label={m.admin.search.label}
            placeholder={m.admin.search.placeholder}
            submitLabel={c.search.submit}
            icon={<Search aria-hidden="true" size={16} />}
          />
        }
      />
      <Card className="mb-6">
        <IssueForm locale={locale} rounds={rounds.map((r) => ({ id: r.id, name: r.name }))} />
      </Card>
      {list.items.length === 0 ? (
        <EmptyState
          icon={<BadgeCheck aria-hidden="true" size={24} />}
          title={m.admin.empty.title}
          description={query.q || type ? m.admin.empty.filtered : m.admin.empty.text}
        />
      ) : (
        <DataTable
          caption={m.admin.table.caption}
          rows={list.items}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'student',
              header: m.admin.table.student,
              render: (r) => (
                <span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{r.nameOnCertificate}</span>
                    <DemoBadge demo={r.demo} locale={locale} />
                  </span>
                  <span className="block text-xs text-ink-muted">{r.user.email}</span>
                </span>
              ),
            },
            { key: 'type', header: m.admin.table.type, render: (r) => m.types[r.type] },
            { key: 'round', header: m.admin.table.round, render: (r) => r.round.name },
            {
              key: 'serial',
              header: m.admin.table.serial,
              render: (r) => <span className="font-mono text-sm">{r.serial}</span>,
            },
            {
              key: 'issued',
              header: m.admin.table.issued,
              className: 'whitespace-nowrap px-5 py-4 text-sm text-ink-muted',
              render: (r) => formatDate(locale, r.issuedAt),
            },
            {
              key: 'state',
              header: m.admin.table.state,
              render: (r) =>
                r.revokedAt ? (
                  <Badge tone="neutral">{m.admin.revokedOn(formatDate(locale, r.revokedAt))}</Badge>
                ) : (
                  <Badge tone="success">{m.admin.valid}</Badge>
                ),
            },
            {
              key: 'action',
              header: m.admin.table.action,
              headerClassName: 'text-right',
              className: 'px-5 py-3 text-right',
              render: (r) =>
                r.revokedAt ? null : (
                  <RevokeButton
                    locale={locale}
                    id={r.id}
                    serial={r.serial}
                    updatedAt={r.updatedAt}
                  />
                ),
            },
          ]}
        />
      )}
      <LinkPagination
        page={list.page}
        totalPages={pages}
        linkAs={Link}
        hrefFor={(page) => hrefWith(PATH, { ...here, page })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(n(list.page), n(pages))}
      />
    </>
  );
}
