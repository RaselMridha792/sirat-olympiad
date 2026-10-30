import { cn } from '../cn';

export interface LineChartPoint {
  /** Full x label for the hover readout and the data table, already formatted (e.g. a date). */
  label: string;
  /** A count. Negative or non-finite values are drawn as 0. */
  value: number;
  /** Axis text under this point. Mark evenly spaced points (e.g. every 7th); narrow charts show fewer. */
  tick?: string;
}

export interface LineChartProps {
  points: LineChartPoint[];
  /** Accessible name of the picture (role="img"): what it shows and its key numbers. */
  summary: string;
  /** Caption of the screen-reader data table. */
  caption: string;
  /** Column headers of the data table. */
  columns: { label: string; value: string };
  /** Formats values for the y axis, the end label, the hover readout and the table (locale digits). */
  formatValue?: (value: number) => string;
  /** Note shown over the plot when every value is 0 (the axes still render). */
  emptyLabel?: string;
  /**
   * Summary of a visible disclosure under the plot (e.g. "Show daily numbers"). When given, the
   * data table opens there for everyone: the hover readout needs a mouse, so touch and keyboard
   * users read the values in the table. Without it the table is for screen readers only.
   */
  dataLabel?: string;
  className?: string;
}

/** Percent string for SVG coordinates, rounded so the markup stays small. */
const pc = (n: number) => `${Math.round(n * 100) / 100}%`;

/** Labels near an edge grow inwards so they never hang outside the plot. */
const anchorAt = (x: number) => (x < 10 ? 'start' : x > 90 ? 'end' : 'middle');

const NICE_STEPS = [1, 2, 2.5, 5] as const;
const MAX_INTERVALS = 5;

/**
 * Clean y ticks for counts, from 0 to a top >= max: the smallest step of 1, 2, 2.5 or 5 × 10^k
 * (whole numbers only) that needs at most five intervals, so the grid stays light (4-6 lines).
 */
function countTicks(max: number): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1, 2, 3, 4];
  for (let power = 10 ** Math.max(0, Math.floor(Math.log10(max / MAX_INTERVALS))); ; power *= 10) {
    for (const factor of NICE_STEPS) {
      const step = factor * power;
      const intervals = Math.ceil(max / step);
      if (Number.isInteger(step) && intervals <= MAX_INTERVALS) {
        return Array.from({ length: intervals + 1 }, (_, i) => i * step);
      }
    }
  }
}

/*
 * X labels are thinned by the chart's own width (container queries), counted back from the latest
 * tick: every 6th by default, every 3rd from @sm, every 2nd from @xl, all from @4xl. Sized so
 * full dates (en and bn) never collide when ticks are a week apart over ~45 days.
 * Class names are literal so Tailwind generates them.
 */
const TICK_TIERS = [
  { stride: 6, shown: '', hidden: 'hidden' },
  { stride: 3, shown: '@sm:inline', hidden: '@sm:hidden' },
  { stride: 2, shown: '@xl:inline', hidden: '@xl:hidden' },
  { stride: 1, shown: '@4xl:inline', hidden: '@4xl:hidden' },
] as const;

function tickVisibility(fromEnd: number): string {
  const classes: string[] = [];
  let previous = true;
  TICK_TIERS.forEach((tier, index) => {
    const visible = fromEnd % tier.stride === 0;
    if (index === 0 ? !visible : visible !== previous) {
      classes.push(visible ? tier.shown : tier.hidden);
    }
    previous = visible;
  });
  return classes.join(' ');
}

/**
 * One series over time: a 2px line over a ~10% area wash, solid hairline grid, an end dot with a
 * surface ring and the latest value as the only direct label (data-viz method). Server-rendered
 * SVG without client JS: hovering a point shows a crosshair, a dot and a readout (CSS only).
 * Text is drawn in CSS pixels (no viewBox scaling), so it stays legible from phone to desktop;
 * only the line and area are stretched, with non-scaling strokes. Colors are token classes only.
 * Accessibility: role="img" with a summary, plus a table with every value: in a visible <details>
 * when `dataLabel` is given, otherwise for screen readers only.
 */
export function LineChart({
  points,
  summary,
  caption,
  columns,
  formatValue = String,
  emptyLabel,
  dataLabel,
  className,
}: LineChartProps) {
  const values = points.map((p) => (Number.isFinite(p.value) && p.value > 0 ? p.value : 0));
  const rows = points.map((p, i) => ({ label: p.label, value: formatValue(values[i] ?? 0) }));
  const max = Math.max(0, ...values);
  const empty = max === 0;
  const ticks = countTicks(max);
  const top = ticks[ticks.length - 1] ?? 1;
  const lastIndex = values.length - 1;
  const xAt = (i: number) => (lastIndex > 0 ? (i / lastIndex) * 100 : 50);
  const yAt = (value: number) => 100 - (value / top) * 100;
  const half = lastIndex > 0 ? 50 / lastIndex : 50;

  const coords = values.map((value, i) => ({ x: xAt(i), y: yAt(value) }));
  const round = (n: number) => Math.round(n * 100) / 100;
  const line = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)},${round(p.y)}`).join('');
  const first = coords[0];
  const end = coords[lastIndex];
  const area =
    first && end ? `M${round(first.x)},100${line.replace(/^M/, 'L')}L${round(end.x)},100Z` : '';
  const endValue = values[lastIndex] ?? 0;
  // The end label sits on the side away from the incoming segment, unless that side has no room.
  const beforeEnd = coords[lastIndex - 1];
  const endLabelBelow = end ? (beforeEnd && beforeEnd.y < end.y ? end.y <= 80 : end.y < 15) : false;

  const tickIndexes = points.flatMap((p, i) => (p.tick === undefined ? [] : [i]));

  return (
    <div className={cn('relative @container', className)}>
      <div role="img" aria-label={summary} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        {/* y axis: equal-height labels spread with justify-between land exactly on the gridlines */}
        <div
          aria-hidden="true"
          className="-my-2 flex flex-col justify-between text-right text-xs leading-4 tabular-nums text-ink-muted"
        >
          {[...ticks].reverse().map((tick) => (
            <span key={tick}>{formatValue(tick)}</span>
          ))}
        </div>

        <svg aria-hidden="true" className="group/plot h-48 w-full overflow-visible @xl:h-56">
          {ticks.map((tick) => (
            <line
              key={tick}
              x1="0"
              x2="100%"
              y1={pc(yAt(tick))}
              y2={pc(yAt(tick))}
              className="stroke-line"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ))}

          {coords.length > 0 ? (
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="overflow-visible"
            >
              {!empty && coords.length > 1 ? <path d={area} className="fill-primary/10" /> : null}
              {coords.length > 1 ? (
                <path
                  d={line}
                  fill="none"
                  className="stroke-primary"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
          ) : null}

          {end && !empty ? (
            <g>
              <circle
                cx={pc(end.x)}
                cy={pc(end.y)}
                r={4}
                strokeWidth={2}
                className="fill-primary stroke-surface"
              />
              <text
                x={pc(end.x)}
                y={pc(end.y)}
                dy={endLabelBelow ? 20 : -10}
                textAnchor={anchorAt(end.x)}
                strokeWidth={3}
                strokeLinejoin="round"
                paintOrder="stroke"
                className="fill-ink stroke-surface text-xs font-semibold group-hover/plot:opacity-0"
              >
                {formatValue(endValue)}
              </text>
            </g>
          ) : null}

          {/* Hover layer: one full-height column per point, so the pointer only has to find the day. */}
          {coords.map((p, i) => {
            const left = Math.max(0, p.x - half);
            const right = Math.min(100, p.x + half);
            return (
              <g key={i} className="group">
                <rect
                  x={pc(left)}
                  y="0"
                  width={pc(right - left)}
                  height="100%"
                  className="fill-transparent"
                />
                <line
                  x1={pc(p.x)}
                  x2={pc(p.x)}
                  y1="20"
                  y2="100%"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                  className="stroke-ink-faint opacity-0 group-hover:opacity-100"
                />
                <circle
                  cx={pc(p.x)}
                  cy={pc(p.y)}
                  r={4}
                  strokeWidth={2}
                  className="fill-primary stroke-surface opacity-0 group-hover:opacity-100"
                />
                <text
                  x={pc(p.x)}
                  y="12"
                  textAnchor={anchorAt(p.x)}
                  strokeWidth={3}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  className="stroke-surface text-xs opacity-0 group-hover:opacity-100"
                >
                  <tspan className="fill-ink font-semibold">{formatValue(values[i] ?? 0)}</tspan>
                  <tspan dx="6" className="fill-ink-muted">
                    {points[i]?.label}
                  </tspan>
                </text>
              </g>
            );
          })}
        </svg>

        <svg aria-hidden="true" className="col-start-2 mt-2 h-5 w-full overflow-visible">
          {tickIndexes.map((pointIndex, k) => {
            const x = xAt(pointIndex);
            return (
              <text
                key={pointIndex}
                x={pc(x)}
                y="14"
                textAnchor={anchorAt(x)}
                className={cn('fill-ink-muted text-xs', tickVisibility(tickIndexes.length - 1 - k))}
              >
                {points[pointIndex]?.tick}
              </text>
            );
          })}
        </svg>
      </div>

      {empty && emptyLabel ? (
        <p className="pointer-events-none absolute inset-x-0 top-0 flex h-48 items-center justify-center p-4 @xl:h-56">
          <span className="rounded-control border border-line bg-surface px-3 py-1.5 text-center text-sm font-medium text-ink-muted">
            {emptyLabel}
          </span>
        </p>
      ) : null}

      {dataLabel ? (
        rows.length > 0 ? (
          <details className="mt-4">
            <summary className="w-fit cursor-pointer rounded-control text-sm font-semibold text-secondary hover:underline">
              {dataLabel}
            </summary>
            {/* A long series scrolls inside this box; it takes focus so keyboards can scroll it. */}
            <div
              role="region"
              aria-label={caption}
              tabIndex={0}
              className="mt-3 max-h-72 overflow-y-auto rounded-control border border-line"
            >
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{caption}</caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="sticky top-0 bg-page px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink-faint"
                    >
                      {columns.label}
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 bg-page px-4 py-2 text-right text-xs font-bold uppercase tracking-wider text-ink-faint"
                    >
                      {columns.value}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <th scope="row" className="px-4 py-2 font-normal text-ink-muted">
                        {row.label}
                      </th>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink">
                        {row.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null
      ) : (
        // sr-only goes on a wrapper: a table ignores width:1px, so it would widen the page.
        <div className="sr-only">
          <table>
            <caption>{caption}</caption>
            <thead>
              <tr>
                <th scope="col">{columns.label}</th>
                <th scope="col">{columns.value}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <th scope="row">{row.label}</th>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
