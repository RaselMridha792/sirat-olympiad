'use client';
import { ErrorState } from '@sirat/ui';
import { useClientI18n } from '@/components/I18nProvider';

/**
 * Body of every dashboard segment's error.tsx. Shows a translated message and a retry, never the
 * raw error (which in production only carries a digest anyway). `retry` (Next 16.3+) re-fetches the
 * segment's server data; `reset` would only re-render the same failed result. The boundary replaces
 * the page and its PageHeader, so the error title is the page's <h1>.
 */
export function RouteError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  reset: () => void;
}) {
  const { states } = useClientI18n();
  return (
    <ErrorState
      title={states.errorTitle}
      titleAs="h1"
      message={states.errorMessage}
      retryLabel={states.retry}
      onRetry={retry}
    />
  );
}
