import type { Metadata } from 'next';
import { Settings } from 'lucide-react';
import type { AdminSetting, AdminSettingKey } from '@sirat/shared';
import { Badge, Card, DetailList, type DetailItem } from '@sirat/ui';
import { FeeDialog, RegistrationSwitch } from '@/components/admin/payments/SettingsActions';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import type { Locale } from '@/i18n';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { adminSettingsMessages, type AdminSettingsMessages } from '@/i18n/messages/admin-payments';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/settings';
const ORDER: AdminSettingKey[] = [
  'registration_open',
  'registration_fee_minor',
  'registration_opens_at',
  'registration_closes_at',
  'payment_expiry_minutes',
];

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminSettingsMessages);
  return { title: m.title };
}

/**
 * Registration settings (plan 3.4; admin only, not manager): open or close registration and change the fee, each
 * from the value this page shows (`expected`), so an old page never overwrites a newer change. The window and the
 * checkout time limit are shown; they are changed through the same API (no form here yet).
 */
export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, data] = await Promise.all([
    getMessages(adminSettingsMessages),
    getData(params),
  ]);
  const settings = await data.admin.listSettings();
  const byKey = new Map(settings.map((s) => [s.key, s]));
  const open = byKey.get('registration_open')?.value === true;
  const fee = byKey.get('registration_fee_minor')?.value;

  const items: DetailItem[] = ORDER.flatMap((key) => {
    const setting = byKey.get(key);
    if (!setting) return [];
    return [
      {
        label: m.keys[key],
        value: (
          <span className="flex flex-col gap-1">
            <span>{valueText(setting, locale, m)}</span>
            <span className="text-xs text-ink-muted">
              {m.updated(formatDateTime(locale, setting.updatedAt))}
            </span>
          </span>
        ),
      },
    ];
  });

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink md:text-2xl">
            <Settings aria-hidden="true" className="h-6 w-6 shrink-0 text-secondary" />
            {m.title}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{m.intro}</p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {byKey.has('registration_open') ? (
            <RegistrationSwitch locale={locale} open={open} />
          ) : null}
          {typeof fee === 'number' ? <FeeDialog locale={locale} currentMinor={fee} /> : null}
        </div>
      </div>
      <DetailList columns={2} items={items} />
    </Card>
  );
}

function valueText(setting: AdminSetting, locale: Locale, m: AdminSettingsMessages) {
  const v = setting.value;
  switch (setting.key) {
    case 'registration_open':
      return (
        <Badge tone={v === true ? 'success' : 'neutral'}>
          {v === true ? m.values.open : m.values.closed}
        </Badge>
      );
    case 'registration_fee_minor':
      return typeof v === 'number' ? `৳${formatNumber(locale, v / 100)}` : m.values.notSet;
    case 'registration_opens_at':
    case 'registration_closes_at':
      return typeof v === 'string' ? formatDateTime(locale, v) : m.values.notSet;
    case 'payment_expiry_minutes':
      return typeof v === 'number' ? m.values.minutes(formatNumber(locale, v)) : m.values.notSet;
  }
}
