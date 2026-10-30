import { cn } from '../cn';
import { initialOf } from '../text';

type Size = 'sm' | 'md' | 'lg';
const sizes: Record<Size, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-20 w-20 text-2xl md:h-24 md:w-24',
};

/**
 * Initial-letter avatar. Replaces the old avatar images and ui-avatars.com calls
 * (which sent participant names to a third party). Decorative: the name is always shown next to it.
 */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: Size;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl bg-primary font-bold text-white',
        sizes[size],
        className,
      )}
    >
      {initialOf(name)}
    </span>
  );
}
