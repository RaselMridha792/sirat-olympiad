import type { Metadata } from 'next';
import { BookOpen, ImageIcon } from 'lucide-react';
import { Card } from '@sirat/ui';
import { BookTitleForm, CoverUpload } from '@/components/admin/book/BookAdminActions';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import { formatNumber } from '@/i18n/format';
import { adminBookMessages } from '@/i18n/messages/admin-book';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

const PATH = '/admin/book';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(adminBookMessages);
  return { title: m.bookTitle };
}

/** The free book (plan §16; admin only): its title for new orders, and its cover (checked and stripped by the API). */
export default async function AdminBookPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess(PATH);
  const params = await searchParams;
  const [{ locale, m }, data] = await Promise.all([
    getMessages(adminBookMessages),
    getData(params),
  ]);
  const book = await data.admin.getBook();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="flex flex-col gap-5">
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-ink md:text-2xl">
          <BookOpen aria-hidden="true" className="h-6 w-6 shrink-0 text-secondary" />
          {m.bookTitle}
        </h1>
        <p className="break-words text-lg font-semibold text-ink">{book.title}</p>
        <BookTitleForm locale={locale} current={book.title} />
      </Card>
      <Card className="flex flex-col gap-5">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
          <ImageIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-secondary" />
          {m.cover.heading}
        </h2>
        {book.cover ? (
          <figure className="flex flex-col gap-2">
            {/* A same-origin image served by the API with nosniff and a fixed type. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={book.cover.url}
              alt={m.cover.alt(book.title)}
              width={book.cover.width}
              height={book.cover.height}
              className="h-56 w-auto self-start rounded-control border border-line object-contain"
            />
            <figcaption className="text-xs text-ink-muted">
              {m.cover.current(
                formatNumber(locale, book.cover.width),
                formatNumber(locale, book.cover.height),
                formatNumber(locale, Math.ceil(book.cover.byteSize / 1024)),
              )}
            </figcaption>
          </figure>
        ) : (
          <p className="text-sm text-ink-muted">{m.cover.none}</p>
        )}
        <CoverUpload locale={locale} />
      </Card>
    </div>
  );
}
