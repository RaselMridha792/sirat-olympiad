import { Skeleton } from '@sirat/ui';
import { common } from '@/i18n/common';

/**
 * Root loading state, shown while a whole route (for example a dashboard layout) streams in. It
 * sits above the translated layouts and must not read cookies or headers (the marketing page stays
 * static), so it shows no visible text and its screen-reader status speaks both languages.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto w-full max-w-6xl p-4 md:p-8">
      <span className="sr-only">
        <span lang="bn">{common.bn.states.loading}</span>{' '}
        <span lang="en">{common.en.states.loading}</span>
      </span>
      <Skeleton className="mb-2 h-8 w-56 max-w-full" />
      <Skeleton className="mb-6 h-4 w-80 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <Skeleton className="mt-6 h-64 rounded-card" />
    </div>
  );
}
