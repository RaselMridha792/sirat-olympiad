import { cn } from '../cn';
import { initialOf } from '../text';

type Size = 'sm' | 'md' | 'lg';
const sizes: Record<Size, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-20 w-20 text-2xl md:h-24 md:w-24',
};

/**
 * Initial-letter avatar. Replaces the old avatar images and the calls to a third-party avatar
 * service (which sent participant names to that service). Decorative: the name is always shown
 * next to it. Inside a client component pass `initial`, worked out on the server with initialOf,
 * so the server HTML and the browser render the same character.
 */
export function Avatar({
  name,
  initial,
  size = 'md',
  className,
}: {
  name: string;
  /** The initial to show, already worked out (initialOf(name) on the server). Overrides `name`. */
  initial?: string;
  size?: Size;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl bg-primary-strong font-bold text-white',
        sizes[size],
        className,
      )}
    >
      {initial ?? initialOf(name)}
    </span>
  );
}
