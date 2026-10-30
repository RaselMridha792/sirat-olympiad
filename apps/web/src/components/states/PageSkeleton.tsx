import { Skeleton } from '@sirat/ui';
import { common } from '@/i18n/common';
import { getMessages } from '@/i18n/server';

/** Body of every dashboard segment's loading.tsx: page-shaped placeholders + a screen-reader status. */
export async function PageSkeleton({
  variant = 'table',
}: {
  variant?: 'table' | 'cards' | 'detail';
}) {
  const { m } = await getMessages(common);
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{m.states.loading}</span>
      <Skeleton className="mb-2 h-8 w-56 max-w-full" />
      <Skeleton className="mb-6 h-4 w-80 max-w-full" />
      {variant === 'cards' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-card" />
          ))}
        </div>
      ) : variant === 'detail' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 rounded-card lg:col-span-2" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface p-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="mb-3 h-10 last:mb-0" />
          ))}
        </div>
      )}
    </div>
  );
}
