'use client';
import type { AdminUserFilters } from '@sirat/shared';
import type { Locale } from '@/i18n';
import { ExportCsvButton } from './ExportCsvButton';

/** The students list's "Export CSV" (core C1): the page's filters, sent as `{ filters, reason }`. */
export function ExportUsersButton({
  locale,
  filters,
}: {
  locale: Locale;
  filters: AdminUserFilters;
}) {
  return <ExportCsvButton locale={locale} kind="users" body={{ filters }} />;
}
