import { cn } from '../cn';

/**
 * Placeholder block for loading.tsx screens. Size it with className (h-*, w-*).
 * The pulse runs only when the user has not asked for reduced motion.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('motion-safe:animate-pulse rounded-control bg-line/70', className)}
    />
  );
}
