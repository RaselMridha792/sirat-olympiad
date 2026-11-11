import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye, Search, ShieldCheck, Users } from 'lucide-react';
import {
  CATEGORIES,
  ROLES,
  type AdminUserDetail,
  type ProfileOptions,
  type Role,
} from '@sirat/shared';
import {
  Avatar,
  Badge,
  buttonClasses,
  Card,
  DataTable,
  DetailList,
  EmptyState,
  LinkPagination,
  SearchBox,
  SelectField,
  Tabs,
  type DetailItem,
} from '@sirat/ui';
import { AmbassadorButton } from '@/components/admin/AmbassadorButton';
import { CorrectGradeButton } from '@/components/admin/CorrectGradeButton';
import { ReissueParticipantIdButton } from '@/components/admin/ReissueParticipantIdButton';
import { ExportUsersButton } from '@/components/admin/ExportUsersButton';
import { LinkPendingIcon } from '@/components/LinkPendingIcon';
import { RouteDialog } from '@/components/RouteDialog';
import { paymentStatusTone, roleTone } from '@/components/status';
import { getData } from '@/data';
import {
  first,
  hrefWith,
  parseEnum,
  parseId,
  parsePageQuery,
  totalPages,
  type SearchParams,
} from '@/data/query';
import type { Locale } from '@/i18n';
import { common, type CommonMessages } from '@/i18n/common';
import { formatDate, formatDateTime, formatNumber } from '@/i18n/format';
import { adminUsersMessages, type AdminUsersMessages } from '@/i18n/messages/admin-users';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/users';
const PAGE_SIZE = 20;
/** Tab order on screen: the old role filter, followed by a separate view of blocked accounts. */
const ROLE_TABS = [
  'student',
  'ambassador',
  'jury',
  'manager',
  'admin',
] as const satisfies readonly Role[];

/** `?registered=true|false`: true, false, or no filter. */
function parseFlag(value: string | string[] | undefined): boolean | undefined {
  const raw = first(value);
  return raw === 'true' ? true : raw === 'false' ? false : undefined;
}

/** Booleans travel as text in the URL; hrefWith would drop a plain `false`. */
const flagParam = (value: boolean | undefined) => (value === undefined ? undefined : String(value));

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminUsersMessages);
  return { title: m.title };
}

/**
 * Admin user list (old admin/user-management): server-side search, role/blocked filters and paging,
 * plus a read-only detail dialog opened by `?user=<id>`. No role change, block, delete or "add member"
 * here: hidden until audited admin endpoints exist (owner decision). The old "add member" flow, which
 * emailed a plaintext temporary password, is dropped for good.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/admin/users');
  const params = await searchParams;
  const [{ locale, m }, { m: c }, data] = await Promise.all([
    getMessages(adminUsersMessages),
    getMessages(common),
    getData(params),
  ]);
  const role = parseEnum(params.role, ROLES);
  const blocked = first(params.blocked) === '1' ? true : undefined;
  const category = parseEnum(params.category, CATEGORIES);
  const registered = parseFlag(params.registered);
  const verified = parseFlag(params.verified);
  const query = {
    ...parsePageQuery(params, PAGE_SIZE),
    role,
    blocked,
    category,
    registered,
    verified,
  };
  const userId = parseId(params.user);
  // The grade table for the correction dialog comes with the detail only (the option lists admit admins).
  const [list, detail, options] = await Promise.all([
    data.admin.listUsers(query),
    userId ? data.admin.getUser(userId) : null,
    userId ? data.student.getProfileOptions() : null,
  ]);
  const pages = totalPages(list.total, list.pageSize);
  // The current filters as URL params (`blocked` travels as "1"); page links and the dialog keep them.
  const extra = {
    category,
    registered: flagParam(registered),
    verified: flagParam(verified),
  };
  const filters = { q: query.q, role, blocked: blocked ? '1' : undefined, ...extra };
  const filtered =
    Boolean(query.q || role || blocked || category) ||
    registered !== undefined ||
    verified !== undefined;
  const tabs = [
    { key: 'all', label: m.tabs.all, href: hrefWith(PATH, { q: query.q, ...extra }) },
    ...ROLE_TABS.map((r) => ({
      key: r,
      label: m.tabs[r],
      href: hrefWith(PATH, { q: query.q, role: r, ...extra }),
    })),
    {
      key: 'blocked',
      label: m.tabs.blocked,
      href: hrefWith(PATH, { q: query.q, blocked: '1', ...extra }),
    },
  ];

  return (
    <>
      <Card className="mb-6 flex flex-col gap-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink md:text-2xl">
              <ShieldCheck aria-hidden="true" className="h-6 w-6 shrink-0 text-secondary" />
              {m.title}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {m.count(formatNumber(locale, list.total), list.total)}
            </p>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-start">
            <SearchBox
              id="user-search"
              action={PATH}
              defaultValue={query.q}
              label={m.search.label}
              placeholder={m.search.placeholder}
              submitLabel={c.search.submit}
              preserve={{ role, blocked: filters.blocked, ...extra }}
              icon={<Search aria-hidden="true" size={16} />}
            />
            <ExportUsersButton
              locale={locale}
              filters={{ q: query.q, role, blocked, category, registered, verified }}
            />
          </div>
        </div>
        <Tabs
          items={tabs}
          activeKey={blocked ? 'blocked' : (role ?? 'all')}
          label={m.tabs.label}
          linkAs={Link}
        />
        {/* Works without JavaScript: a GET form that keeps the search, the role tab and the blocked view. */}
        <form
          method="get"
          action={PATH}
          aria-label={m.filters.label}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          {query.q ? <input type="hidden" name="q" value={query.q} /> : null}
          {role ? <input type="hidden" name="role" value={role} /> : null}
          {blocked ? <input type="hidden" name="blocked" value="1" /> : null}
          <SelectField
            id="filter-category"
            name="category"
            label={m.filters.category}
            placeholder={m.filters.any}
            defaultValue={category ?? ''}
            options={CATEGORIES.map((value) => ({ value, label: c.categories[value] }))}
          />
          <SelectField
            id="filter-registered"
            name="registered"
            label={m.filters.registered}
            placeholder={m.filters.any}
            defaultValue={flagParam(registered) ?? ''}
            options={[
              { value: 'true', label: m.filters.registeredYes },
              { value: 'false', label: m.filters.registeredNo },
            ]}
          />
          <SelectField
            id="filter-verified"
            name="verified"
            label={m.filters.verified}
            placeholder={m.filters.any}
            defaultValue={flagParam(verified) ?? ''}
            options={[
              { value: 'true', label: m.filters.verifiedYes },
              { value: 'false', label: m.filters.verifiedNo },
            ]}
          />
          <button type="submit" className={buttonClasses({ variant: 'outline' })}>
            {m.filters.apply}
          </button>
        </form>
      </Card>

      {list.items.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden="true" size={24} />}
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
          rowKey={(u) => u.id}
          columns={[
            {
              key: 'profile',
              header: m.table.profile,
              render: (u) => (
                <div className="flex items-center gap-3">
                  <Avatar name={u.name} size="sm" />
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{u.name}</p>
                    <p className="text-xs text-ink-muted">{u.email}</p>
                    {u.phoneLast3 ? (
                      <p className="text-xs text-ink-muted">{m.phoneEnding(u.phoneLast3)}</p>
                    ) : null}
                  </div>
                </div>
              ),
            },
            {
              key: 'role',
              header: m.table.role,
              render: (u) => <Badge tone={roleTone[u.role]}>{c.roles[u.role]}</Badge>,
            },
            {
              key: 'category',
              header: m.table.category,
              render: (u) =>
                u.category ? (
                  c.categories[u.category]
                ) : (
                  <span className="text-ink-muted">{c.notProvided}</span>
                ),
            },
            {
              key: 'registration',
              header: m.table.registration,
              render: (u) =>
                u.registration ? (
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={paymentStatusTone[u.registration.paymentStatus]}>
                      {c.paymentStatus[u.registration.paymentStatus]}
                    </Badge>
                    {u.needsPaymentReview ? (
                      <Badge tone="danger">{m.registration.review}</Badge>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-ink-muted">{m.registration.none}</span>
                ),
            },
            {
              key: 'verified',
              header: m.table.verified,
              render: (u) => (
                <Badge tone={u.emailVerified ? 'success' : 'neutral'}>
                  {u.emailVerified ? m.verified.yes : m.verified.no}
                </Badge>
              ),
            },
            {
              key: 'status',
              header: m.table.status,
              render: (u) => <StatusBadge blocked={u.isBlocked} m={m} />,
            },
            {
              key: 'joined',
              header: m.table.joined,
              className: 'whitespace-nowrap px-5 py-4 text-sm text-ink-muted',
              render: (u) => formatDate(locale, u.createdAt),
            },
            {
              key: 'view',
              header: m.table.details,
              headerClassName: 'text-right',
              className: 'px-5 py-3 text-right',
              // `replace`: opening swaps this history entry and RouteDialog's close swaps it back,
              // so viewing users leaves no extra list entries for Back to step through.
              render: (u) => (
                <Link
                  href={hrefWith(PATH, { ...filters, page: list.page, user: u.id })}
                  replace
                  scroll={false}
                  aria-label={m.viewDetails(u.name)}
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
        hrefFor={(page) => hrefWith(PATH, { ...filters, page })}
        label={c.pagination.label}
        prevLabel={c.pagination.prev}
        nextLabel={c.pagination.next}
        summary={c.pagination.summary(formatNumber(locale, list.page), formatNumber(locale, pages))}
      />

      {userId ? (
        <RouteDialog
          key={userId}
          title={detail?.name ?? m.notFoundTitle}
          closeLabel={c.states.close}
          closeHref={hrefWith(PATH, { ...filters, page: list.page })}
        >
          {detail ? (
            <UserDetails
              user={detail}
              locale={locale}
              m={m}
              c={c}
              gradeLevels={options?.gradeLevels ?? []}
            />
          ) : (
            <p className="text-sm text-ink-muted">{m.notFoundText}</p>
          )}
        </RouteDialog>
      ) : null}
    </>
  );
}

function StatusBadge({ blocked, m }: { blocked: boolean; m: AdminUsersMessages }) {
  return (
    <Badge tone={blocked ? 'danger' : 'success'}>
      {blocked ? m.status.blocked : m.status.active}
    </Badge>
  );
}

/** Body of the detail dialog (old "User Detailed Profile" modal), rendered on the server. */
function UserDetails({
  user,
  locale,
  m,
  c,
  gradeLevels,
}: {
  user: AdminUserDetail;
  locale: Locale;
  m: AdminUsersMessages;
  c: CommonMessages;
  gradeLevels: ProfileOptions['gradeLevels'];
}) {
  const d = m.detail;
  const missing = <span className="text-ink-muted">{c.notProvided}</span>;
  const payment = user.payment;
  const paymentItems: DetailItem[] = payment
    ? [
        {
          label: d.payment,
          value: (
            <Badge tone={paymentStatusTone[payment.status]}>
              {c.paymentStatus[payment.status]}
            </Badge>
          ),
        },
        { label: d.invoice, value: <span className="font-mono">{payment.invoiceNumber}</span> },
        {
          label: d.amount,
          value: `${formatNumber(locale, payment.amountMinor / 100)} ${payment.currency}`,
        },
        ...(payment.paidAt
          ? [{ label: d.paidAt, value: formatDateTime(locale, payment.paidAt) }]
          : []),
      ]
    : [{ label: d.payment, value: <span className="text-ink-muted">{d.noPayment}</span> }];
  const items: DetailItem[] = [
    { label: d.email, value: user.email },
    { label: d.phone, value: user.phone ?? missing },
    { label: d.district, value: user.district ?? missing },
    { label: d.institution, value: user.institution ?? missing },
    { label: d.educationType, value: user.educationType ?? missing },
    { label: d.gradeLevel, value: user.gradeLevel?.label ?? missing },
    { label: d.category, value: user.category ? c.categories[user.category] : missing },
    {
      label: d.emailVerified,
      value: user.emailVerifiedAt ? (
        formatDateTime(locale, user.emailVerifiedAt)
      ) : (
        <span className="text-ink-muted">{d.notVerified}</span>
      ),
    },
    ...paymentItems,
    ...(user.referredBy
      ? [
          {
            label: d.referredBy,
            value: user.referredBy.promoCode
              ? `${user.referredBy.name} (${user.referredBy.promoCode})`
              : user.referredBy.name,
          },
        ]
      : []),
    ...(user.ambassador
      ? [
          {
            label: d.ambassadorCode,
            value: <span className="font-mono">{user.ambassador.promoCode}</span>,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Avatar name={user.name} size="md" />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={roleTone[user.role]}>{c.roles[user.role]}</Badge>
          <StatusBadge blocked={user.isBlocked} m={m} />
          <span className="text-xs text-ink-muted">
            {d.joinedOn(formatDate(locale, user.createdAt))}
          </span>
        </div>
      </div>
      {user.needsPaymentReview ? (
        <p role="note" className="text-sm font-medium text-danger-strong">
          {d.review}
        </p>
      ) : null}
      <DetailList items={items} />
      {/* A paid student can become an ambassador; an approved one can be revoked (core C5a). */}
      {user.ambassador?.approvedAt ? (
        <div>
          <AmbassadorButton locale={locale} userId={user.id} action="revoke" />
        </div>
      ) : user.role === 'student' && user.registration && !user.isBlocked ? (
        <div>
          <AmbassadorButton locale={locale} userId={user.id} action="approve" />
        </div>
      ) : null}
      {(user.role === 'student' || user.role === 'ambassador') && gradeLevels.length > 0 ? (
        <div>
          <CorrectGradeButton
            locale={locale}
            userId={user.id}
            currentGradeId={user.gradeLevel?.id ?? null}
            gradeLevels={gradeLevels.map(({ id, label }) => ({ id, label }))}
          />
        </div>
      ) : null}
      {/* A registration has a participant ID; a leaked one is replaced here (payments P1b). */}
      {user.registration ? (
        <div>
          <ReissueParticipantIdButton locale={locale} userId={user.id} />
        </div>
      ) : null}
    </div>
  );
}
