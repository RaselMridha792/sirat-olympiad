import type { Locale } from './index';
import { intlTag, TIME_ZONE } from './config.ts';

/**
 * Display formatting. Times are always shown in Asia/Dhaka (docs/05-DATABASE.md), whatever the
 * device clock or time zone says. Values come from the server as ISO strings.
 */
export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(intlTag(locale)).format(value);
}

export function formatDate(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * Date and 24-hour time, e.g. en "2 Nov 2026, 00:27", bn "২ নভে, ২০২৬, ০০:২৭". A fixed `h23`
 * clock keeps both languages on the same clock and keeps Latin "AM"/"PM" (the bn-BD 12-hour
 * pattern) out of Bangla text.
 */
export function formatDateTime(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** Seconds as m:ss (e.g. exam time taken), with locale digits. */
export function formatDuration(locale: Locale, totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  const nf = new Intl.NumberFormat(intlTag(locale), { minimumIntegerDigits: 2 });
  return `${formatNumber(locale, minutes)}:${nf.format(seconds)}`;
}
