import type { ReactNode } from 'react';

/**
 * A dashboard page whose data does not open at launch (LAUNCH-PLAN §8). Not an error: neutral tokens and no retry
 * button, since trying again cannot help. `data-state="coming-soon"` is what the page checks look for
 * (apps/web/scripts/check-pages.mjs). Pass translated text only.
 */
export function ComingSoon({
  title,
  message,
  icon,
  action,
}: {
  title: string;
  message: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      data-state="coming-soon"
      className="rounded-card border border-line bg-surface px-6 py-16 text-center"
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-page text-ink-faint"
        >
          {icon}
        </div>
      ) : null}
      <p className="text-lg font-bold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-prose text-sm text-ink-muted">{message}</p>
      {action ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">{action}</div>
      ) : null}
    </div>
  );
}
