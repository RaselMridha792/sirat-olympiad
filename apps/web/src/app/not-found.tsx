import type { Metadata } from 'next';
import Link from 'next/link';
import { common } from '@/i18n/common';

const { bn, en } = common;

export const metadata: Metadata = { title: `${bn.notFound.title} / ${en.notFound.title}` };

/**
 * Root 404: every unmatched URL, and notFound() outside the two dashboards (they have their own,
 * translated not-found inside their shells). It sits above the translated layouts and must not
 * read cookies or headers (the marketing page stays static), so it shows both languages, Bangla
 * first.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p aria-hidden="true" className="text-5xl font-extrabold text-secondary">
        404
      </p>
      <h1 className="text-2xl font-bold text-ink">
        <span lang="bn" className="block">
          {bn.notFound.title}
        </span>{' '}
        <span lang="en" className="block">
          {en.notFound.title}
        </span>
      </h1>
      <div className="max-w-md space-y-1 text-ink-muted">
        <p lang="bn">{bn.notFound.text}</p>
        <p lang="en">{en.notFound.text}</p>
      </div>
      <Link href="/" className="font-semibold text-secondary underline">
        <span lang="bn">{bn.notFound.back}</span> <span aria-hidden="true">/</span>{' '}
        <span lang="en">{en.notFound.back}</span>
      </Link>
    </main>
  );
}
