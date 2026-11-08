import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface TimelineItem {
  id: string;
  title: string;
  /** A date, a period or a short label above the title. */
  when?: string;
  body?: ReactNode;
  /** The stage's number or icon (the `steps` variant), already localized by the caller. */
  marker?: ReactNode;
  /** Not fixed yet (e.g. "to be announced"): a hollow dot. */
  pending?: boolean;
}

/**
 * An ordered timeline (an <ol>, so the order is read out).
 * - `dates`: a vertical line of dots with the date first (a roadmap).
 * - `steps`: numbered stages joined by a line: stacked on phones, side by side from md up (the rounds).
 * `tone="dark"` for a dark band (bg-shell).
 */
export function Timeline({
  items,
  variant = 'dates',
  tone = 'light',
  className,
}: {
  items: readonly TimelineItem[];
  variant?: 'dates' | 'steps';
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const dark = tone === 'dark';
  if (variant === 'steps') {
    return (
      <ol className={cn('grid gap-6 md:grid-cols-3 md:gap-8', className)}>
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              'relative flex flex-col rounded-card border p-6 not-last:after:absolute not-last:after:top-full not-last:after:left-[calc(3rem-1px)] not-last:after:h-6 not-last:after:w-0.5 not-last:after:bg-primary md:not-last:after:left-auto md:not-last:after:top-12 md:not-last:after:-right-8 md:not-last:after:h-0.5 md:not-last:after:w-8 md:not-last:after:bg-primary',
              dark ? 'border-white/10 bg-white/5' : 'border-line bg-surface shadow-card',
            )}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-strong text-xl font-extrabold text-white">
                {item.marker}
              </span>
              {item.when ? (
                <span
                  className={cn('text-sm font-semibold', dark ? 'text-white/75' : 'text-ink-muted')}
                >
                  {item.when}
                </span>
              ) : null}
            </div>
            <h3 className="mt-5 text-xl leading-snug font-bold">{item.title}</h3>
            {item.body ? (
              <div
                className={cn(
                  'mt-3 flex-1 leading-relaxed',
                  dark ? 'text-white/75' : 'text-ink-muted',
                )}
              >
                {item.body}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className={cn('flex flex-col', className)}>
      {items.map((item, index) => (
        <li key={item.id} className="grid grid-cols-[1.5rem_1fr] gap-x-4">
          <div aria-hidden="true" className="flex flex-col items-center">
            <span
              className={cn(
                'mt-1.5 h-4 w-4 shrink-0 rounded-full border-4',
                item.pending
                  ? dark
                    ? 'border-white/30'
                    : 'border-line bg-surface'
                  : 'border-primary bg-surface',
              )}
            />
            {index < items.length - 1 ? (
              <span className={cn('mt-1 w-0.5 flex-1', dark ? 'bg-white/15' : 'bg-line')} />
            ) : null}
          </div>
          <div className={cn(index < items.length - 1 && 'pb-8')}>
            {item.when ? (
              <p
                className={cn(
                  'text-sm font-bold',
                  item.pending
                    ? dark
                      ? 'text-white/60'
                      : 'text-ink-muted'
                    : dark
                      ? 'text-accent'
                      : 'text-primary-strong',
                )}
              >
                {item.when}
              </p>
            ) : null}
            <h3 className="mt-0.5 text-lg leading-snug font-bold">{item.title}</h3>
            {item.body ? (
              <div
                className={cn('mt-1 leading-relaxed', dark ? 'text-white/75' : 'text-ink-muted')}
              >
                {item.body}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
