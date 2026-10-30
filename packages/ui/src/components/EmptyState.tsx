import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface px-6 py-16 text-center">
      {icon ? (
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-page text-ink-faint"
        >
          {icon}
        </div>
      ) : null}
      <p className="font-bold text-ink-muted">{title}</p>
      {description ? <p className="mt-1 text-sm text-ink-faint">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-10 text-ink-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-primary" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/**
 * Friendly failure panel (old Fallbacks/LoadFailedFallback.jsx). Never pass raw server or exception
 * text here: show a translated message and offer a retry.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = 'Try again',
  action,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-card border border-danger/30 bg-danger-soft px-6 py-8 text-center"
    >
      {title ? <p className="text-lg font-bold text-danger">{title}</p> : null}
      <p className="mt-1 font-semibold text-danger">{message}</p>
      {onRetry || action ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-control bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              {retryLabel}
            </button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
