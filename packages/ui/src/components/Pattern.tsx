import { cn } from '../cn';

/*
 * Islamic geometric ornament, drawn as inline SVG in currentColor: the caller's text colour and opacity classes
 * colour it, so it follows the tokens and needs no image file. Decorative only (aria-hidden, no pointer events).
 * Geometry, never figures: no person or prophet is ever depicted (owner, 2026-11-03).
 */

/** The 8-point star (two squares, one turned 45°) as a 16-point outline in a 24×24 box. */
const STAR_POINTS = Array.from({ length: 16 }, (_, i) => {
  // Outer points on radius 1, the crossings of the two squares on radius cos(45°)/cos(22.5°) ≈ 0.7654.
  const radius = i % 2 === 0 ? 12 : 12 * 0.7654;
  const angle = ((i * 22.5 - 90) * Math.PI) / 180;
  return `${(12 + radius * Math.cos(angle)).toFixed(2)},${(12 + radius * Math.sin(angle)).toFixed(2)}`;
}).join(' ');

/** A small solid 8-point star: a bullet, a brand mark or a kicker ornament. */
export function StarMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={cn('h-4 w-4', className)}
    >
      <polygon points={STAR_POINTS} fill="currentColor" />
    </svg>
  );
}

/**
 * A lattice of 8-point stars joined by lines (the khatam pattern), filling its positioned parent behind the content.
 * `id` names the SVG pattern, so it must be unique on the page.
 */
export function GeometricPattern({
  id,
  className,
  size = 64,
}: {
  id: string;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cn('pointer-events-none absolute inset-0 -z-10 h-full w-full', className)}
    >
      <defs>
        <pattern
          id={id}
          width={size}
          height={size}
          viewBox="0 0 64 64"
          patternUnits="userSpaceOnUse"
        >
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="16" y="16" width="32" height="32" />
            <path d="M32 9.37 54.63 32 32 54.63 9.37 32Z" />
            <path d="M32 0v9.37M32 54.63V64M0 32h9.37M54.63 32H64M0 0l16 16M64 0 48 16M0 64l16-16M64 64 48 48" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** A large ornament: nested 8-point stars in rings, for a hero or a band. */
export function StarOrnament({ className }: { className?: string }) {
  const square = (half: number, turned: boolean) => (
    <rect
      x={100 - half}
      y={100 - half}
      width={half * 2}
      height={half * 2}
      transform={turned ? 'rotate(45 100 100)' : undefined}
    />
  );
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 200 200" className={className}>
      <g fill="none" stroke="currentColor">
        <circle cx="100" cy="100" r="97" strokeWidth="0.75" strokeDasharray="1.5 5" />
        <circle cx="100" cy="100" r="88" strokeWidth="0.75" />
        <g strokeWidth="1.25">
          {square(62, false)}
          {square(62, true)}
        </g>
        <circle cx="100" cy="100" r="47" strokeWidth="0.75" />
        <g strokeWidth="1">
          {square(33, false)}
          {square(33, true)}
        </g>
        <circle cx="100" cy="100" r="12" strokeWidth="0.75" />
      </g>
    </svg>
  );
}
