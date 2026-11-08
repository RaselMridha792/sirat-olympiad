import { cn } from '../cn';

export interface BigStat {
  label: string;
  /** Already localized, e.g. "৬৪" or "1,000+". */
  value: string;
}

/**
 * A row of headline numbers (two per row on phones, four from md up), as a <dl>: the label is the term, the number
 * its value, shown number first. `tone="dark"` for a dark band.
 */
export function BigStats({
  items,
  tone = 'light',
  className,
}: {
  items: readonly BigStat[];
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const dark = tone === 'dark';
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-card border md:grid-cols-4',
        dark ? 'border-white/10 bg-white/10' : 'border-line bg-line',
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            'flex flex-col-reverse items-center justify-center gap-1 px-3 py-8 text-center md:py-10',
            dark ? 'bg-shell' : 'bg-surface',
          )}
        >
          <dt className={cn('text-sm font-medium', dark ? 'text-white/75' : 'text-ink-muted')}>
            {item.label}
          </dt>
          <dd
            className={cn(
              'text-3xl font-extrabold tabular-nums sm:text-4xl md:text-5xl',
              dark ? 'text-white' : 'text-secondary',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
