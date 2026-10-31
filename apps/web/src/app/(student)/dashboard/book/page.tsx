import type { Metadata } from 'next';
import { BookOpen, Lock } from 'lucide-react';
import { Card } from '@sirat/ui';
import { BookOrderForm } from '@/components/book/BookOrderForm';
import { getData } from '@/data';
import type { SearchParams } from '@/data/query';
import { bookMessages } from '@/i18n/messages/book';
import { getMessages } from '@/i18n/server';
import { requireAccess } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getMessages(bookMessages);
  return { title: m.metaTitle };
}

/**
 * The free book (plan §16; owner B1–B5): the title and cover, then the delivery address. Only the student's own order
 * ever reaches this page (the API takes the user from the session). The form is pre-filled from the student's own
 * name, phone and district.
 */
export default async function BookPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAccess('/dashboard/book');
  const params = await searchParams;
  const [{ locale, m }, data] = await Promise.all([getMessages(bookMessages), getData(params)]);
  const [book, mine, profile] = await Promise.all([
    data.student.getBook(),
    data.student.getBookOrder(),
    data.student.getProfile(),
  ]);

  return (
    <>
      <Card className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-center">
        {book.coverUrl ? (
          // A same-origin image served by the API with nosniff and a fixed type (checked in data/http/book.ts).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={book.coverUrl}
            alt=""
            width={120}
            height={180}
            className="h-44 w-auto shrink-0 self-center rounded-control border border-line object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary-strong"
          >
            <BookOpen className="h-9 w-9" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-ink md:text-2xl">{m.title}</h1>
          <p className="mt-1 break-words text-lg font-semibold text-ink">{book.title}</p>
          <p className="mt-2 text-sm text-ink-muted">{m.intro}</p>
        </div>
      </Card>
      <Card>
        {mine.eligible ? (
          <BookOrderForm
            locale={locale}
            order={mine.order}
            profile={{ name: profile.name, phone: profile.phone, district: profile.district }}
          />
        ) : (
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-page text-ink-faint"
            >
              <Lock className="h-6 w-6" />
            </span>
            <div>
              <h2 className="font-bold text-ink">{m.notEligible.title}</h2>
              <p className="mt-1 text-sm text-ink-muted">{m.notEligible.text}</p>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
