import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye, TicketPercent } from 'lucide-react';
import {
  DISCOUNT_CODE_STATUSES,
  type AdminDiscountCode,
  type AdminDiscountCodeQuery,
  type AdminDiscountCodeUses,
} from '@sirat/shared';
import {
  Badge,
  buttonClasses,
  Card,
  DataTable,
  DetailList,
  EmptyState,
  Field,
  LinkPagination,
  SelectField,
  type DetailItem,
} from '@sirat/ui';
import { DeleteDiscountCodeButton } from '@/components/admin/discount-codes/DeleteDiscountCodeButton';
import { DiscountCodeForm } from '@/components/admin/discount-codes/DiscountCodeForm';
import { LinkPendingIcon } from '@/components/LinkPendingIcon';
import { RouteDialog } from '@/components/RouteDialog';
import { getData } from '@/data';
import {
  first,
  hrefWith,
  parseEnum,
  parseId,
  parsePageQuery,
  parseSearch,
  totalPages,
  type SearchParams,
} from '@/data/query';
import type { Locale } from '@/i18n';
import { common, type CommonMessages } from '@/i18n/common';
import { formatDateTime, formatNumber } from '@/i18n/format';
import {
  adminDiscountCodesMessages,
  type AdminDiscountCodesMessages,
} from '@/i18n/messages/admin-discount-codes';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/discount-codes';
const PAGE_SIZE = 20;
const USES_PAGE_SIZE = 10;

const STATUS_TONE = {
  active: 'success',
  inactive: 'neutral',
  expired: 'warning',
  scheduled: 'info',
} as const;

/** Only well-formed filters reach the API (it answers 400 to anything else, which would be an error page). */
function parseFilters(params: SearchParams) {
  const q = parseSearch(params.q)?.toUpperCase();
  return {
    q: q && /^[A-Z0-9-]{1,20}$/.test(q) ? q : undefined,
    status: parseEnum(params.status, DISCOUNT_CODE_STATUSES),
    linked: first(params.linked) === '1' ? true : undefined,
  };
}

const taka = (locale: Locale, minor: number) => formatNumber(locale, minor / 100);
const discountText = (locale: Locale, c: AdminDiscountCode) =>
  c.kind === 'amount' ? `৳${taka(locale, c.value)}` : `${formatNumber(locale, c.value)}%`;

function windowText(locale: Locale, m: AdminDiscountCodesMessages, c: AdminDiscountCode) {
  const from = c.startsAt ? formatDateTime(locale, c.startsAt) : null;
  const to = c.endsAt ? formatDateTime(locale, c.endsAt) : null;
  if (from && to) return m.between(from, to);
  if (from) return m.from(from);
  if (to) return m.until(to);
  return m.always;
}

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminDiscountCodesMessages);
  return { title: m.title };
}

/**
 * Admin discount codes (payments D2; DECISIONS "Discount codes"; admin only, as the API): the list with its filters, a
 * new code (typed or generated), and a detail dialog (`?code=<id>`) with the edit form, the delete of an unused code,
 * and the paid uses with their totals (`&uses=<page>`).
 */
export default async function AdminDiscountCodesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminDiscountCodesMessages),
    getMessages(common),
    getData(params),
  ]);
  const filters = parseFilters(params);
  const { page, pageSize } = parsePageQuery(params, PAGE_SIZE);
  const query: AdminDiscountCodeQuery = { page, pageSize, ...filters };
  const codeId = parseId(params.code);
  const usesPage = Math.max(1, Number(first(params.uses)) || 1);
  const [list, detail, uses] = await Promise.all([
    data.admin.listDiscountCodes(query),
    codeId ? data.admin.getDiscountCode(codeId) : null,
    codeId
      ? data.admin.listDiscountCodeUses(codeId, { page: usesPage, pageSize: USES_PAGE_SIZE })
      : null,
  ]);
  const pages = totalPages(list.total, list.pageSize);
  const linkFilters = { ...filters, linked: filters.linked ? '1' : undefined };
  const filtered = Object.values(filters).some((v) => v !== undefined);

  return (
    <>
      <Card className="mb-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink md:text-2xl">
              <TicketPercent aria-hidden="true" className="h-6 w-6 shrink-0 text-secondary" />
              {m.title}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {m.count(formatNumber(locale, list.total))}
            </p>
          </div>
          <DiscountCodeForm locale={locale} />
        </div>
        <p className="text-sm text-ink-muted">{m.intro}</p>
        {/* Works without JavaScript: a GET form. */}
        <form
          method="get"
          action={PATH}
          aria-label={m.filters.label}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          <Field
            id="filter-q"
            name="q"
            label={m.filters.q}
            defaultValue={filters.q ?? ''}
            maxLength={20}
            autoComplete="off"
          />
          <SelectField
            id="filter-status"
            name="status"
            label={m.filters.status}
            placeholder={m.filters.any}
            defaultValue={filters.status ?? ''}
            options={DISCOUNT_CODE_STATUSES.map((value) => ({ value, label: m.status[value] }))}
          />
          <SelectField
            id="filter-linked"
            name="linked"
            label={m.filters.linked}
            placeholder={m.filters.any}
            defaultValue={filters.linked ? '1' : ''}
            options={[{ value: '1', label: m.filters.linkedOnly }]}
          />
          <button type="submit" className={buttonClasses({ variant: 'outline' })}>
            {m.filters.apply}
          </button>
        </form>
      </Card>

      {list.items.length === 0 ? (
        <EmptyState
          icon={<TicketPercent aria-hidden="true" size={24} />}
          title={m.empty.title}
          description={filtered ? m.empty.filtered : m.empty.none}
          action={
            filtered ? (
              <Link href={PATH} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                {m.empty.clear}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          caption={m.table.caption}
          rows={list.items}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'code',
              header: m.table.code,
              render: (row) => (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-ink">{row.code}</span>
                  {row.demo ? <Badge tone="info">{m.demo}</Badge> : null}
                </div>
              ),
            },
            {
              key: 'discount',
              header: m.table.discount,
              className: 'whitespace-nowrap px-5 py-4 text-sm',
              render: (row) => discountText(locale, row),
            },
            {
              key: 'uses',
              header: m.table.uses,
              className: 'px-5 py-4 text-sm',
              render: (row) =>
                m.usesLine(
                  formatNumber(locale, row.uses.paid),
                  formatNumber(locale, row.uses.live),
                  row.maxUses === null ? null : formatNumber(locale, row.maxUses),
                ),
            },
            {
              key: 'window',
              header: m.table.window,
              className: 'px-5 py-4 text-xs text-ink-muted',
              render: (row) => windowText(locale, m, row),
            },
            {
              key: 'status',
              header: m.table.status,
              render: (row) => {
                return <Badge tone={STATUS_TONE[row.status]}>{m.status[row.status]}</Badge>;
              },
            },
            {
              key: 'ambassador',
              header: m.table.ambassador,
              className: 'px-5 py-4 text-sm',
              render: (row) =>
                row.ambassador ? (
                  <span>
                    {row.ambassador.name}
                    {row.ambassador.promoCode ? (
                      <span className="ms-1 font-mono text-xs text-ink-muted">
                        ({row.ambassador.promoCode})
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-ink-muted">{m.none}</span>
                ),
            },
            {
              key: 'view',
              header: m.table.details,
              headerClassName: 'text-right',
              className: 'px-5 py-3 text-right',
              render: (row) => (
                <Link
                  href={hrefWith(PATH, { ...linkFilters, page: list.page, code: row.id })}
                  replace
                  scroll={false}
                  aria-label={m.viewDetails(row.code)}
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
        hrefFor={(n) => hrefWith(PATH, { ...linkFilters, page: n })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(formatNumber(locale, list.page), formatNumber(locale, pages))}
      />

      {codeId ? (
        <RouteDialog
          key={codeId}
          title={detail?.code ?? m.notFoundTitle}
          closeLabel={c.states.close}
          closeHref={hrefWith(PATH, { ...linkFilters, page: list.page })}
        >
          {detail ? (
            <CodeDetails
              code={detail}
              uses={uses}
              locale={locale}
              m={m}
              c={c}
              usesHref={(n) =>
                hrefWith(PATH, { ...linkFilters, page: list.page, code: detail.id, uses: n })
              }
            />
          ) : (
            <p className="text-sm text-ink-muted">{m.notFoundText}</p>
          )}
        </RouteDialog>
      ) : null}
    </>
  );
}

/** Body of the detail dialog, rendered on the server; the edit and delete are small client parts. */
function CodeDetails({
  code,
  uses,
  locale,
  m,
  c,
  usesHref,
}: {
  code: AdminDiscountCode;
  uses: AdminDiscountCodeUses | null;
  locale: Locale;
  m: AdminDiscountCodesMessages;
  c: CommonMessages;
  usesHref: (page: number) => string;
}) {
  const d = m.detail;
  const none = <span className="text-ink-muted">{m.none}</span>;
  const s = code.status;
  const items: DetailItem[] = [
    { label: d.code, value: <span className="font-mono">{code.code}</span> },
    { label: d.discount, value: discountText(locale, code) },
    { label: d.status, value: <Badge tone={STATUS_TONE[s]}>{m.status[s]}</Badge> },
    {
      label: d.uses,
      value: m.usesLine(
        formatNumber(locale, code.uses.paid),
        formatNumber(locale, code.uses.live),
        null,
      ),
    },
    {
      label: d.limit,
      value: code.maxUses === null ? d.noLimit : formatNumber(locale, code.maxUses),
    },
    { label: d.window, value: windowText(locale, m, code) },
    {
      label: d.ambassador,
      value: code.ambassador
        ? `${code.ambassador.name}${code.ambassador.promoCode ? ` (${code.ambassador.promoCode})` : ''}`
        : none,
    },
    { label: d.note, value: code.note ?? none },
    { label: d.created, value: formatDateTime(locale, code.createdAt) },
    { label: d.updated, value: formatDateTime(locale, code.updatedAt) },
  ];
  const unused = code.uses.paid === 0 && code.uses.live === 0;
  const usesPages = uses ? totalPages(uses.total, uses.pageSize) : 1;
  return (
    <div className="flex flex-col gap-6">
      <DetailList columns={2} items={items} />
      {code.demo ? (
        <p className="text-sm text-ink-muted">{d.demoNote}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {code.locked ? <p className="text-sm text-ink-muted">{d.locked}</p> : null}
          <div className="flex flex-wrap gap-2">
            <DiscountCodeForm locale={locale} code={code} />
            {unused ? <DeleteDiscountCodeButton locale={locale} id={code.id} /> : null}
          </div>
        </div>
      )}
      <section>
        <h3 className="mb-1 text-sm font-bold text-ink">{d.usesTitle}</h3>
        {uses && uses.total > 0 ? (
          <>
            <p className="mb-2 text-xs text-ink-muted">
              {d.totals(
                formatNumber(locale, uses.totals.uses),
                taka(locale, uses.totals.discountMinor),
                taka(locale, uses.totals.collectedMinor),
              )}
            </p>
            <DataTable
              caption={d.usesCaption}
              rows={uses.items}
              rowKey={(u) => u.paymentId}
              columns={[
                {
                  key: 'student',
                  header: d.student,
                  className: 'px-3 py-2 text-xs',
                  render: (u) => u.name ?? m.none,
                },
                {
                  key: 'participant',
                  header: d.participantId,
                  className: 'whitespace-nowrap px-3 py-2 font-mono text-xs',
                  render: (u) => u.participantIdMasked ?? m.none,
                },
                {
                  key: 'paidAt',
                  header: d.paidAt,
                  className: 'whitespace-nowrap px-3 py-2 text-xs text-ink-muted',
                  render: (u) => (u.paidAt ? formatDateTime(locale, u.paidAt) : m.none),
                },
                {
                  key: 'paid',
                  header: d.paid,
                  className: 'whitespace-nowrap px-3 py-2 text-xs',
                  render: (u) =>
                    `৳${taka(locale, u.amountMinor)} (−৳${taka(locale, u.discountMinor)})`,
                },
                {
                  key: 'invoice',
                  header: d.invoice,
                  className: 'px-3 py-2 font-mono text-xs',
                  render: (u) => u.invoiceNumber,
                },
              ]}
            />
            {usesPages > 1 ? (
              <LinkPagination
                page={uses.page}
                totalPages={usesPages}
                linkAs={Link}
                hrefFor={usesHref}
                label={c.pagination.label}
                prevLabel={c.pagination.prev}
                nextLabel={c.pagination.next}
                summary={c.pagination.summary(
                  formatNumber(locale, uses.page),
                  formatNumber(locale, usesPages),
                )}
              />
            ) : null}
          </>
        ) : (
          <p className="text-sm text-ink-muted">{d.noUses}</p>
        )}
      </section>
    </div>
  );
}
