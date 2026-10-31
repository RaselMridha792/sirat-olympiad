import type { Metadata } from 'next';
import Link from 'next/link';
import { CreditCard, Eye, Receipt } from 'lucide-react';
import {
  normalizeBdMobile,
  PAYMENT_STATUSES,
  type AdminPaymentDetail,
  type AdminPaymentQuery,
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
import { PaymentActions } from '@/components/admin/payments/PaymentActions';
import { LinkPendingIcon } from '@/components/LinkPendingIcon';
import { RouteDialog } from '@/components/RouteDialog';
import { paymentStatusTone } from '@/components/status';
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
import { adminPaymentsMessages, type AdminPaymentsMessages } from '@/i18n/messages/admin-payments';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/payments';
const PAGE_SIZE = 20;
const RECONCILABLE = new Set(['pending', 'failed', 'expired']);

/** Only well-formed filters reach the API (it answers 400 to anything else, which would be an error page). */
function parseFilters(params: SearchParams) {
  const invoice = parseSearch(params.invoice)?.toUpperCase();
  const trx = parseSearch(params.trx);
  const phone = parseSearch(params.phone);
  const email = parseSearch(params.email)?.toLowerCase();
  return {
    invoice: invoice && /^[A-Z0-9]{10,20}$/.test(invoice) ? invoice : undefined,
    trx: trx && trx.length >= 4 && trx.length <= 100 ? trx : undefined,
    phone: phone ? (normalizeBdMobile(phone) ?? undefined) : undefined,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    status: parseEnum(params.status, PAYMENT_STATUSES),
    review: first(params.review) === '1' ? true : undefined,
  };
}

const money = (locale: Locale, minor: number) => `৳${formatNumber(locale, minor / 100)}`;
const reasonLabel = (m: AdminPaymentsMessages, reason: string) =>
  (m.reasons as Record<string, string>)[reason] ?? reason;

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminPaymentsMessages);
  return { title: m.title };
}

/**
 * Admin payments (plan 6.7; admin only, as the API): look a payment up by invoice, PayStation trx_id, mobile number
 * or email, or list the ones set aside for review; a detail dialog (`?payment=<id>`) shows its history and offers
 * "ask PayStation again" and, for a success without a trx_id only, the manual reconcile (RUNBOOK §11).
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminPaymentsMessages),
    getMessages(common),
    getData(params),
  ]);
  const filters = parseFilters(params);
  const { page, pageSize } = parsePageQuery(params, PAGE_SIZE);
  const query: AdminPaymentQuery = { page, pageSize, ...filters };
  const paymentId = parseId(params.payment);
  const [list, detail] = await Promise.all([
    data.admin.listPayments(query),
    paymentId ? data.admin.getPayment(paymentId) : null,
  ]);
  const pages = totalPages(list.total, list.pageSize);
  const linkFilters = { ...filters, review: filters.review ? '1' : undefined };
  const filtered = Object.values(filters).some((v) => v !== undefined);

  return (
    <>
      <Card className="mb-6 flex flex-col gap-5">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink md:text-2xl">
            <CreditCard aria-hidden="true" className="h-6 w-6 shrink-0 text-secondary" />
            {m.title}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{m.count(formatNumber(locale, list.total))}</p>
        </div>
        {/* Works without JavaScript: a GET form. */}
        <form
          method="get"
          action={PATH}
          aria-label={m.filters.label}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:items-end"
        >
          <Field
            id="filter-invoice"
            name="invoice"
            label={m.filters.invoice}
            defaultValue={filters.invoice ?? ''}
            maxLength={20}
            autoComplete="off"
          />
          <Field
            id="filter-trx"
            name="trx"
            label={m.filters.trx}
            defaultValue={filters.trx ?? ''}
            maxLength={100}
            autoComplete="off"
          />
          <Field
            id="filter-phone"
            name="phone"
            label={m.filters.phone}
            type="tel"
            defaultValue={filters.phone ?? ''}
            maxLength={20}
            autoComplete="off"
          />
          <Field
            id="filter-email"
            name="email"
            label={m.filters.email}
            type="email"
            defaultValue={filters.email ?? ''}
            maxLength={254}
            autoComplete="off"
          />
          <SelectField
            id="filter-status"
            name="status"
            label={m.filters.status}
            placeholder={m.filters.any}
            defaultValue={filters.status ?? ''}
            options={PAYMENT_STATUSES.map((value) => ({ value, label: c.paymentStatus[value] }))}
          />
          <SelectField
            id="filter-review"
            name="review"
            label={m.filters.review}
            placeholder={m.filters.any}
            defaultValue={filters.review ? '1' : ''}
            options={[{ value: '1', label: m.filters.reviewOnly }]}
          />
          <button type="submit" className={buttonClasses({ variant: 'outline' })}>
            {m.filters.apply}
          </button>
        </form>
      </Card>

      {list.items.length === 0 ? (
        <EmptyState
          icon={<Receipt aria-hidden="true" size={24} />}
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
          rowKey={(p) => p.id}
          columns={[
            {
              key: 'invoice',
              header: m.table.invoice,
              render: (p) => (
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-ink">{p.invoiceNumber}</p>
                  <p className="text-xs text-ink-muted">{formatDateTime(locale, p.createdAt)}</p>
                </div>
              ),
            },
            {
              key: 'payer',
              header: m.table.payer,
              render: (p) => (
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{p.attempt.name}</p>
                  <p className="text-xs text-ink-muted">{p.attempt.email}</p>
                </div>
              ),
            },
            {
              key: 'amount',
              header: m.table.amount,
              className: 'whitespace-nowrap px-5 py-4 text-sm',
              render: (p) => money(locale, p.amountMinor),
            },
            {
              key: 'status',
              header: m.table.status,
              render: (p) => (
                <Badge tone={paymentStatusTone[p.status]}>{c.paymentStatus[p.status]}</Badge>
              ),
            },
            {
              key: 'review',
              header: m.table.review,
              render: (p) =>
                p.reviewReason ? (
                  <Badge tone={p.reviewReason === 'late_success' ? 'warning' : 'danger'}>
                    {reasonLabel(m, p.reviewReason)}
                  </Badge>
                ) : (
                  <span className="text-ink-muted">{m.detail.none}</span>
                ),
            },
            {
              key: 'view',
              header: m.table.details,
              headerClassName: 'text-right',
              className: 'px-5 py-3 text-right',
              render: (p) => (
                <Link
                  href={hrefWith(PATH, { ...linkFilters, page: list.page, payment: p.id })}
                  replace
                  scroll={false}
                  aria-label={m.viewDetails(p.invoiceNumber)}
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

      {paymentId ? (
        <RouteDialog
          key={paymentId}
          title={detail?.payment.invoiceNumber ?? m.notFoundTitle}
          closeLabel={c.states.close}
          closeHref={hrefWith(PATH, { ...linkFilters, page: list.page })}
        >
          {detail ? (
            <PaymentDetails detail={detail} locale={locale} m={m} c={c} />
          ) : (
            <p className="text-sm text-ink-muted">{m.notFoundText}</p>
          )}
        </RouteDialog>
      ) : null}
    </>
  );
}

/** Body of the detail dialog, rendered on the server; the two actions are a small client part. */
function PaymentDetails({
  detail,
  locale,
  m,
  c,
}: {
  detail: AdminPaymentDetail;
  locale: Locale;
  m: AdminPaymentsMessages;
  c: CommonMessages;
}) {
  const { payment: p, events } = detail;
  const d = m.detail;
  const none = <span className="text-ink-muted">{d.none}</span>;
  const when = (iso: string | null) => (iso ? formatDateTime(locale, iso) : none);
  const attemptStatus =
    (d.attemptStatus as Record<string, string>)[p.attempt.status] ?? p.attempt.status;
  const items: DetailItem[] = [
    {
      label: d.status,
      value: <Badge tone={paymentStatusTone[p.status]}>{c.paymentStatus[p.status]}</Badge>,
    },
    { label: d.amount, value: money(locale, p.amountMinor) },
    {
      label: d.paidAmount,
      value: p.paidAmountMinor === null ? none : money(locale, p.paidAmountMinor),
    },
    { label: d.trxId, value: p.trxId ? <span className="font-mono">{p.trxId}</span> : none },
    { label: d.gatewayStatus, value: p.gatewayStatus ?? none },
    { label: d.account, value: <span className="font-mono">{p.gatewayAccount}</span> },
    { label: d.checks, value: formatNumber(locale, p.checkCount) },
    { label: d.lastChecked, value: when(p.lastCheckedAt) },
    { label: d.created, value: when(p.createdAt) },
    { label: d.expires, value: when(p.expiresAt) },
    { label: d.paidAt, value: when(p.paidAt) },
    {
      label: d.review,
      value: p.reviewReason ? (
        <span className="flex flex-col gap-1">
          <Badge tone="danger">{reasonLabel(m, p.reviewReason)}</Badge>
          <span className="text-xs text-ink-muted">{m.runbook}</span>
        </span>
      ) : (
        none
      ),
    },
    { label: d.name, value: p.attempt.name },
    { label: d.email, value: p.attempt.email },
    { label: d.phone, value: p.attempt.phone },
    { label: d.attempt, value: attemptStatus },
    { label: d.studentAccount, value: p.userId ? d.hasAccount : d.noAccount },
  ];
  return (
    <div className="flex flex-col gap-6">
      <DetailList columns={2} items={items} />
      <PaymentActions
        locale={locale}
        paymentId={p.id}
        canReconcile={p.reviewReason === 'success_without_trx_id' && RECONCILABLE.has(p.status)}
      />
      <section>
        <h3 className="mb-2 text-sm font-bold text-ink">{d.history}</h3>
        <DataTable
          caption={d.historyCaption}
          rows={events}
          rowKey={(e) => e.id}
          columns={[
            {
              key: 'time',
              header: d.time,
              className: 'whitespace-nowrap px-3 py-2 text-xs text-ink-muted',
              render: (e) => formatDateTime(locale, e.createdAt),
            },
            {
              key: 'source',
              header: d.source,
              className: 'px-3 py-2 text-xs',
              render: (e) => (m.sources as Record<string, string>)[e.source] ?? e.source,
            },
            {
              key: 'outcome',
              header: d.outcome,
              className: 'px-3 py-2 font-mono text-xs',
              render: (e) => e.outcome,
            },
            {
              key: 'trxStatus',
              header: d.trxStatus,
              className: 'px-3 py-2 text-xs',
              render: (e) => e.trxStatus ?? e.statusCode ?? d.none,
            },
            {
              key: 'by',
              header: d.by,
              className: 'px-3 py-2 text-xs',
              render: (e) => (e.byAdmin ? d.byAdmin : d.bySystem),
            },
          ]}
        />
      </section>
    </div>
  );
}
