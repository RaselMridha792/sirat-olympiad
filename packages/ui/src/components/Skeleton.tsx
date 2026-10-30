import { cn } from '../cn';

/** Placeholder block for loading.tsx screens. Size it with className (h-*, w-*). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('animate-pulse rounded-control bg-line/70', className)} />
  );
}
