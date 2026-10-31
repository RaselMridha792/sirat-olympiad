import type { Metadata } from 'next';
import Link from 'next/link';
import { PackageOpen, Truck } from 'lucide-react';
import {
  BD_DISTRICTS,
  BOOK_ORDER_STATUSES,
  normalizeBdMobile,
  type AdminBookOrderQuery,
} from '@sirat/shared';
import {
  Badge,
  buttonClasses,
  Card,
  DataTable,
  EmptyState,
  Field,
  LinkPagination,
  SelectField,
} from '@sirat/ui';
import { ExportOrdersButton, ShipSelected } from '@/components/admin/book/BookAdminActions';
import { getData } from '@/data';
import {
  hrefWith,
  parseEnum,
  parsePageQuery,
  parseSearch,
  totalPages,
  type SearchParams,
} from '@/data/query';
import { common } from '@/i18n/common';
import { formatDate, formatNumber } from '@/i18n/format';
import { adminBookMessages } from '@/i18n/messages/admin-book';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/book-orders';
const PAGE_SIZE = 50;

/** Only well-formed filters reach the API (it answers 400 to anything else, which would be an error page). */
function parseFilters(params: SearchParams) {
  const phone = parseSearch(params.phone);
  const email = parseSearch(params.email)?.toLowerCase();
  return {
    status: parseEnum(params.status, BOOK_ORDER_STATUSES),
    district: parseEnum(params.district, BD_DISTRICTS),
    phone: phone ? (normalizeBdMobile(phone) ?? undefined) : undefined,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminBookMessages);
  return { title: m.orders.title };
}

/**
 * The free book's orders (plan §16.4; admin only): search and page, export the courier CSV for the current status and
 * district, and mark the ticked confirmed orders shipped (after a confirmation; a shipped order cannot be changed).
 */
export default async function AdminBookOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminBookMessages),
    getMessages(common),
    getData(params),
  ]);
  const o = m.orders;
  const filters = parseFilters(params);
  const { page, pageSize } = parsePageQuery(params, PAGE_SIZE);
  const query: AdminBookOrderQuery = { page, pageSize, ...filters };
  const list = await data.admin.listBookOrders(query);
  const pages = totalPages(list.total, list.pageSize);
  const filtered = Object.values(filters).some((v) => v !== undefined);

  return (
    <>
      <Card className="mb-6 flex flex-col gap-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink md:text-2xl">
              <Truck aria-hidden="true" className="h-6 w-6 shrink-0 text-secondary" />
              {o.title}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {o.count(formatNumber(locale, list.total))}
            </p>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-start">
            <ExportOrdersButton
              locale={locale}
              filters={{ status: filters.status, district: filters.district }}
            />
            <ShipSelected locale={locale} />
          </div>
        </div>
        {/* Works without JavaScript: a GET form. */}
        <form
          method="get"
          action={PATH}
          aria-label={o.filters.label}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
        >
          <SelectField
            id="filter-status"
            name="status"
            label={o.filters.status}
            placeholder={o.filters.any}
            defaultValue={filters.status ?? ''}
            options={BOOK_ORDER_STATUSES.map((value) => ({ value, label: o.status[value] }))}
          />
          <SelectField
            id="filter-district"
            name="district"
            label={o.filters.district}
            placeholder={o.filters.any}
            defaultValue={filters.district ?? ''}
            options={BD_DISTRICTS.map((d) => ({ value: d, label: d }))}
          />
          <Field
            id="filter-phone"
            name="phone"
            type="tel"
            label={o.filters.phone}
            defaultValue={filters.phone ?? ''}
            maxLength={20}
            autoComplete="off"
          />
          <Field
            id="filter-email"
            name="email"
            type="email"
            label={o.filters.email}
            defaultValue={filters.email ?? ''}
            maxLength={254}
            autoComplete="off"
          />
          <button type="submit" className={buttonClasses({ variant: 'outline' })}>
            {o.filters.apply}
          </button>
        </form>
      </Card>

      {list.items.length === 0 ? (
        <EmptyState
          icon={<PackageOpen aria-hidden="true" size={24} />}
          title={o.empty.title}
          description={filtered ? o.empty.filtered : o.empty.none}
          action={
            filtered ? (
              <Link href={PATH} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                {o.empty.clear}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          caption={o.table.caption}
          rows={list.items}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'select',
              header: o.table.select,
              render: (r) =>
                r.status === 'confirmed' ? (
                  <input
                    type="checkbox"
                    name="ids"
                    value={r.id}
                    form="ship-form"
                    aria-label={o.table.selectRow(r.code)}
                    className="h-4 w-4"
                  />
                ) : null,
            },
            {
              key: 'code',
              header: o.table.code,
              render: (r) => <span className="font-mono text-sm font-semibold">{r.code}</span>,
            },
            {
              key: 'recipient',
              header: o.table.recipient,
              render: (r) => (
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{r.recipientName}</p>
                  <p className="text-xs text-ink-muted">{r.recipientPhone}</p>
                </div>
              ),
            },
            {
              key: 'address',
              header: o.table.address,
              render: (r) => (
                <div className="min-w-0 text-sm">
                  <p className="break-words">{r.addressLine}</p>
                  <p className="text-xs text-ink-muted">
                    {r.upazila}, {r.district}
                  </p>
                  {r.note ? <p className="text-xs italic text-ink-muted">{r.note}</p> : null}
                </div>
              ),
            },
            {
              key: 'student',
              header: o.table.student,
              render: (r) => (
                <div className="min-w-0 text-xs">
                  <p className="font-semibold text-ink">{r.student.name}</p>
                  <p className="text-ink-muted">{r.student.email}</p>
                </div>
              ),
            },
            {
              key: 'status',
              header: o.table.status,
              render: (r) => (
                <Badge tone={r.status === 'shipped' ? 'success' : 'info'}>
                  {o.status[r.status]}
                </Badge>
              ),
            },
            {
              key: 'confirmed',
              header: o.table.confirmed,
              className: 'whitespace-nowrap px-5 py-4 text-sm text-ink-muted',
              render: (r) => formatDate(locale, r.confirmedAt),
            },
          ]}
        />
      )}

      <LinkPagination
        page={list.page}
        totalPages={pages}
        linkAs={Link}
        hrefFor={(n) => hrefWith(PATH, { ...filters, page: n })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(formatNumber(locale, list.page), formatNumber(locale, pages))}
      />
    </>
  );
}
