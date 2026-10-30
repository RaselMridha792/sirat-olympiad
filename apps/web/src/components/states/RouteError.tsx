'use client';
import { ErrorState } from '@sirat/ui';
import { useClientI18n } from '@/components/I18nProvider';

/**
 * Body of every dashboard segment's error.tsx. Shows a translated message and a retry, never the
 * raw error (which in production only carries a digest anyway).
 */
export function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { states } = useClientI18n();
  return (
    <ErrorState
      title={states.errorTitle}
      message={states.errorMessage}
      retryLabel={states.retry}
      onRetry={reset}
    />
  );
}
