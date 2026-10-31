/**
 * CSV for admin exports (RFC 4180, CRLF rows), opened in Excel by admins. Shared by every export (students list;
 * payments' courier list can use it too). No personal data passes through any log here.
 */

/** UTF-8 byte order mark: without it Excel reads Bangla as mojibake. */
export const CSV_BOM = '﻿';

/** A cell Excel would run as a formula (CSV injection); a leading apostrophe makes it text. */
const FORMULA_START = /^[=+\-@\t\r]/;

export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: readonly CsvValue[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

const DHAKA = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `YYYY-MM-DD HH:mm` in Asia/Dhaka (what the admins read), or '' for none. */
export function dhakaDateTime(value: Date | null | undefined): string {
  if (!value) return '';
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    DHAKA.formatToParts(value).find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}
