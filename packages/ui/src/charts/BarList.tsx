import { cn } from '../cn';

export interface BarListItem {
  key: string;
  label: string;
  /** Drives the bar length. Negative or non-finite values are drawn as 0. */
  value: number;
  /** The value as shown, already formatted (locale digits). */
  valueLabel: string;
  /** Optional share as shown, already formatted (e.g. "42%"). */
  shareLabel?: string;
}

/*
 * primary / secondary: one hue for every bar (items without an order).
 * ordinal: navy steps from dark to light for ordered stages such as a funnel, so the order also
 * reads in the color. Checked with the data-viz validator (--ordinal, against the track color):
 * monotone lightness, adjacent steps >= 0.06 apart, lightest step 2.1:1 on its track.
 * Class names are literal so Tailwind generates them.
 */
const TONES = {
  primary: { track: 'fill-primary-soft', bars: ['fill-primary'] },
  secondary: { track: 'fill-secondary-soft', bars: ['fill-secondary'] },
  ordinal: {
    track: 'fill-secondary-soft',
    bars: [
      'fill-secondary',
      'fill-secondary/85',
      'fill-secondary/70',
      'fill-secondary/55',
      'fill-secondary/40',
    ],
  },
} as const;

export interface BarListProps {
  items: BarListItem[];
  /** Accessible name of the picture (role="img"): what it shows and its key numbers. */
  summary: string;
  /** Caption of the screen-reader data table. */
  caption: string;
  /** Column headers of the data table (`share` only when items carry a shareLabel). */
  columns: { label: string; value: string; share?: string };
  /** Value of a full-width bar. Defaults to the largest value; pass the whole for share-of-whole bars. */
  max?: number;
  tone?: keyof typeof TONES;
  /** Note shown under the rows when every value is 0 (the rows still render). */
  emptyLabel?: string;
  className?: string;
}

/**
 * Labelled horizontal bars on one baseline, for part-to-whole and funnels (replaces the old donut:
 * bars compare more exactly than slices). Every bar is directly labelled with its value and share,
 * so no legend and no tooltip are needed. Server-rendered, no client JS; bar widths are SVG
 * attributes (no inline styles). Accessibility: role="img" with a summary, plus a screen-reader table.
 */
export function BarList({
  items,
  summary,
  caption,
  columns,
  max,
  tone = 'primary',
  emptyLabel,
  className,
}: BarListProps) {
  const values = items.map((item) =>
    Number.isFinite(item.value) && item.value > 0 ? item.value : 0,
  );
  const scale = max !== undefined && max > 0 ? max : Math.max(0, ...values);
  const empty = values.every((value) => value === 0);
  const { track, bars } = TONES[tone];
  const showShare =
    columns.share !== undefined && items.some((item) => item.shareLabel !== undefined);
  const barClass = (index: number) =>
    bars[items.length > 1 ? Math.round((index * (bars.length - 1)) / (items.length - 1)) : 0] ??
    bars[0];

  return (
    <div className={cn('min-w-0', className)}>
      <div role="img" aria-label={summary} className="space-y-4">
        {items.map((item, index) => {
          const value = values[index] ?? 0;
          // A non-zero value always leaves a visible sliver; zero draws nothing.
          const width =
            scale > 0 && value > 0 ? Math.min(100, Math.max(1, (value / scale) * 100)) : 0;
          return (
            <div key={item.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-ink">{item.label}</span>
                <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                  <span className="font-semibold text-ink">{item.valueLabel}</span>
                  {showShare ? (
                    <span className="min-w-10 text-right text-xs text-ink-muted">
                      {item.shareLabel}
                    </span>
                  ) : null}
                </span>
              </div>
              <svg aria-hidden="true" className="block h-2.5 w-full">
                <rect width="100%" height="100%" rx={5} className={track} />
                {width > 0 ? (
                  <rect
                    width={`${Math.round(width * 100) / 100}%`}
                    height="100%"
                    rx={5}
                    className={barClass(index)}
                  />
                ) : null}
              </svg>
            </div>
          );
        })}
      </div>

      {empty && emptyLabel ? <p className="mt-4 text-sm text-ink-muted">{emptyLabel}</p> : null}

      {/* sr-only goes on a wrapper: a table ignores width:1px, so it would widen the page. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{columns.label}</th>
              <th scope="col">{columns.value}</th>
              {showShare ? <th scope="col">{columns.share}</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key}>
                <th scope="row">{item.label}</th>
                <td>{item.valueLabel}</td>
                {showShare ? <td>{item.shareLabel ?? ''}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
