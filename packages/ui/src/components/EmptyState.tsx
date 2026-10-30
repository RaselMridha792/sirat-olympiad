import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface px-6 py-16 text-center">
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

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-card border border-danger/30 bg-danger-soft px-6 py-8 text-center">
      <p className="font-semibold text-danger">{message}</p>
      {onRetry ? (
        <button onClick={onRetry} className="mt-3 text-sm font-semibold text-danger underline">
          Try again
        </button>
      ) : null}
    </div>
  );
}
