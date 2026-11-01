import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Eye, ScrollText } from 'lucide-react';
import { AUDIT_ACTION_PATTERN, type AdminAuditDetail, type AdminAuditRow } from '@sirat/shared';
import { Badge, buttonClasses, Card, DataTable, DetailList, EmptyState, Field } from '@sirat/ui';
import { ExportCsvButton } from '@/components/admin/ExportCsvButton';
import { LinkPendingIcon } from '@/components/LinkPendingIcon';
import { RouteDialog } from '@/components/RouteDialog';
import { roleTone } from '@/components/status';
import { getData } from '@/data';
import { first, hrefWith, parseId, type SearchParams } from '@/data/query';
import type { Locale } from '@/i18n';
import { common, type CommonMessages } from '@/i18n/common';
import { formatDateTime } from '@/i18n/format';
import { adminAuditMessages, type AdminAuditMessages } from '@/i18n/messages/admin-audit';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/audit';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ACTOR = /^(?:system|[^\s@]+@[^\s@]+\.[^\s@]+)$/;
const CURSOR = /^[A-Za-z0-9_-]{1,120}$/;

/** A URL value that matches its pattern, else no filter (a hand-edited URL never reaches the API as a 400). */
function parseText(value: string | string[] | undefined, pattern: RegExp, max: number) {
  const raw = first(value)?.trim();
  return raw && raw.length <= max && pattern.test(raw) ? raw : undefined;
}

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminAuditMessages);
  return { title: m.title };
}

/**
 * The audit-log viewer (admin only; 06-API "Audit log"). A GET filter form, newest-first keyset pages ("Older
 * entries"), and the row detail in a dialog (`?id=`), the only place an IP, an email or the meta is shown. Read only.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminAuditMessages),
    getMessages(common),
    getData(params),
  ]);
  const filters = {
    action: parseText(params.action, AUDIT_ACTION_PATTERN, 80),
    actor: parseText(params.actor, ACTOR, 254),
    from: parseText(params.from, DAY, 10),
    to: parseText(params.to, DAY, 10),
  };
  const before = parseText(params.before, CURSOR, 120);
  const entryId = parseId(params.id);
  const [page, entry] = await Promise.all([
    data.admin.listAudit({ ...filters, before }),
    entryId ? data.admin.getAuditEntry(entryId) : null,
  ]);
  const filtered = Boolean(filters.action || filters.actor || filters.from || filters.to);
  const here = { ...filters, before };

  return (
    <>
      <Card className="mb-6 flex flex-col gap-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink md:text-2xl">
              <ScrollText aria-hidden="true" className="h-6 w-6 shrink-0 text-secondary" />
              {m.title}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">{m.subtitle}</p>
          </div>
          <ExportCsvButton locale={locale} kind="audit" body={filters} />
        </div>
        {/* Works without JavaScript: a GET form; a new filter starts again from the newest entry. */}
        <form
          method="get"
          action={PATH}
          aria-label={m.filters.label}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
        >
          <Field
            id="audit-action"
            name="action"
            label={m.filters.action}
            hint={m.filters.actionHint}
            defaultValue={filters.action ?? ''}
            maxLength={80}
            autoComplete="off"
          />
          <Field
            id="audit-actor"
            name="actor"
            label={m.filters.actor}
            hint={m.filters.actorHint}
            defaultValue={filters.actor ?? ''}
            maxLength={254}
            autoComplete="off"
          />
          <Field
            id="audit-from"
            name="from"
            type="date"
            label={m.filters.from}
            defaultValue={filters.from ?? ''}
          />
          <Field
            id="audit-to"
            name="to"
            type="date"
            label={m.filters.to}
            defaultValue={filters.to ?? ''}
          />
          <div className="flex gap-2">
            <button type="submit" className={buttonClasses({ variant: 'outline' })}>
              {m.filters.apply}
            </button>
            {filtered ? (
              <Link href={PATH} className={buttonClasses({ variant: 'ghost' })}>
                {m.filters.clear}
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {page.items.length === 0 ? (
        <EmptyState
          icon={<ScrollText aria-hidden="true" size={24} />}
          title={m.empty.title}
          description={filtered ? m.empty.filtered : m.empty.none}
        />
      ) : (
        <DataTable
          caption={m.table.caption}
          rows={page.items}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'time',
              header: m.table.time,
              className: 'whitespace-nowrap px-5 py-4 text-sm text-ink-muted',
              render: (r) => formatDateTime(locale, r.createdAt),
            },
            {
              key: 'action',
              header: m.table.action,
              render: (r) => <code className="text-sm font-semibold text-ink">{r.action}</code>,
            },
            {
              key: 'actor',
              header: m.table.actor,
              render: (r) => <Actor row={r} m={m} c={c} />,
            },
            {
              key: 'entity',
              header: m.table.entity,
              className: 'px-5 py-4 text-sm text-ink-muted',
              render: (r) => entityText(r, m),
            },
            {
              key: 'view',
              header: m.table.details,
              headerClassName: 'text-right',
              className: 'px-5 py-3 text-right',
              render: (r) => (
                <Link
                  href={hrefWith(PATH, { ...here, id: r.id })}
                  replace
                  scroll={false}
                  aria-label={m.viewDetails(r.action, formatDateTime(locale, r.createdAt))}
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

      <nav aria-label={m.table.caption} className="mt-4 flex flex-wrap justify-end gap-3">
        {before ? (
          <Link
            href={hrefWith(PATH, filters)}
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
          >
            {m.newest}
          </Link>
        ) : null}
        {page.next ? (
          <Link
            href={hrefWith(PATH, { ...filters, before: page.next })}
            className={buttonClasses({ variant: 'outline', size: 'sm' })}
          >
            {m.older}
            <ChevronRight aria-hidden="true" size={16} />
          </Link>
        ) : null}
      </nav>

      {entryId ? (
        <RouteDialog
          key={entryId}
          title={entry ? entry.action : m.detail.notFoundTitle}
          closeLabel={c.states.close}
          closeHref={hrefWith(PATH, here)}
        >
          {entry ? (
            <EntryDetails entry={entry} locale={locale} m={m} c={c} />
          ) : (
            <p className="text-sm text-ink-muted">{m.detail.notFoundText}</p>
          )}
        </RouteDialog>
      ) : null}
    </>
  );
}

function Actor({ row, m, c }: { row: AdminAuditRow; m: AdminAuditMessages; c: CommonMessages }) {
  if (row.system) return <Badge tone="neutral">{m.system}</Badge>;
  if (!row.actor) return <span className="text-ink-muted">{m.unknownActor}</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="font-semibold text-ink">{row.actor.name}</span>
      <Badge tone={roleTone[row.actor.role]}>{c.roles[row.actor.role]}</Badge>
    </div>
  );
}

const entityText = (r: AdminAuditRow, m: AdminAuditMessages) =>
  r.entityType ? `${r.entityType}${r.entityId ? ` · ${r.entityId}` : ''}` : m.detail.none;

/** The dialog body: the only place the IP, the actor's email and the meta appear. Text only (React escapes it). */
function EntryDetails({
  entry,
  locale,
  m,
  c,
}: {
  entry: AdminAuditDetail;
  locale: Locale;
  m: AdminAuditMessages;
  c: CommonMessages;
}) {
  const d = m.detail;
  const meta =
    entry.meta === null || entry.meta === undefined ? null : JSON.stringify(entry.meta, null, 2);
  return (
    <div className="flex flex-col gap-4">
      <DetailList
        items={[
          { label: d.time, value: formatDateTime(locale, entry.createdAt) },
          { label: d.action, value: <code>{entry.action}</code> },
          { label: d.actor, value: <Actor row={entry} m={m} c={c} /> },
          { label: d.actorEmail, value: entry.actorEmail ?? d.none },
          { label: d.ip, value: entry.ip ?? d.none },
          { label: d.entity, value: entityText(entry, m) },
        ]}
      />
      <div>
        <h3 className="text-sm font-semibold text-ink">{d.meta}</h3>
        {meta ? (
          <pre className="mt-2 max-h-80 overflow-auto rounded-control bg-page p-3 text-xs text-ink">
            {meta}
          </pre>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">{d.none}</p>
        )}
      </div>
    </div>
  );
}
