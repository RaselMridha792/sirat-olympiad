import Link from 'next/link';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Card, cn } from '@sirat/ui';
import type { DataSource } from '@/data/source';
import type { Locale } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { pick } from '@/i18n/messages';
import { bookMessages } from '@/i18n/messages/book';

const LINK =
  'inline-flex items-center gap-1.5 text-sm font-semibold text-secondary hover:underline';

/**
 * The free book on the student's dashboard home (plan §16.4; owner B4: the dashboard keeps reminding until an address
 * is given). Core's home composes it with one line: `<BookOrderCard data={data} locale={locale} />`. It reads the
 * student's own order (GET /book-order/me) and shows only the status and the district, never the address.
 */
export async function BookOrderCard({ data, locale }: { data: DataSource; locale: Locale }) {
  const m = pick(bookMessages, locale).card;
  const mine = await data.student.getBookOrder();
  const order = mine.order;
  let text: string;
  let action: { href: string; label: string } | null = { href: '/dashboard/book', label: m.view };
  if (!mine.eligible) {
    text = m.notEligible;
    action = null;
  } else if (!order) {
    text = m.none;
    action = { href: '/dashboard/book', label: m.confirm };
  } else if (order.status === 'shipped') {
    text = m.shipped(order.shippedAt ? formatDate(locale, order.shippedAt) : '');
  } else {
    text = m.confirmed(order.district);
    action = { href: '/dashboard/book', label: m.change };
  }

  return (
    <Card className="mb-8 flex items-start gap-4">
      <span
        aria-hidden="true"
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-control',
          mine.eligible ? 'bg-primary-soft text-primary-strong' : 'bg-page text-ink-faint',
        )}
      >
        <BookOpen className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-bold text-ink">{m.title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{text}</p>
        {action ? (
          <Link href={action.href} className={cn('mt-3', LINK)}>
            {action.label}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
