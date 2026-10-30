import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { common } from '@/i18n/common';
import { getMessages } from '@/i18n/server';

/**
 * notFound() inside the admin area (for example an unknown exam id): the 404 stays inside the admin
 * shell, in the admin's language. It replaces the page, so it carries the page's one <h1>
 * (EmptyState's title is a <p>, hence the same card written out here).
 */
export default async function AdminNotFound() {
  const { m } = await getMessages(common);
  return (
    <div className="rounded-card border border-dashed border-line bg-surface px-6 py-16 text-center">
      <div
        aria-hidden="true"
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-page text-ink-faint"
      >
        <SearchX size={26} />
      </div>
      <h1 className="text-lg font-bold text-ink">{m.notFound.title}</h1>
      <p className="mt-1 text-sm text-ink-muted">{m.notFound.text}</p>
      <Link href="/admin" className="mt-4 inline-block font-semibold text-secondary underline">
        {m.notFound.back}
      </Link>
    </div>
  );
}
