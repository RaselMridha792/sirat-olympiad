'use client';
import type { ReactNode } from 'react';
import { useLinkStatus } from 'next/link';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@sirat/ui';

/**
 * Icon for a next/link whose target needs a server round trip before anything changes on screen,
 * e.g. the eye link that opens a URL-driven dialog (loading.tsx does not show again when only
 * search params change). Shows `children`, the idle icon rendered by the server. While the link's
 * navigation is pending it shows a spinner of the same `size` instead and marks itself busy, so
 * the click visibly registered. When motion is allowed the spinner fades in after 100 ms (fast
 * navigations do not flash) and turns; going back to idle is instant. Render it inside the <Link>,
 * because useLinkStatus reads the nearest one. Plain props only: a number and a rendered node.
 */
export function LinkPendingIcon({ size, children }: { size: number; children: ReactNode }) {
  const { pending } = useLinkStatus();
  // The transition classes are present only while pending. Browsers take transitions from the new
  // style, so the change to pending is delayed and faded, and the change back applies at once.
  const delayed = 'motion-safe:transition-opacity motion-safe:delay-100';
  return (
    <span aria-busy={pending || undefined} className="grid place-items-center">
      <span className={cn('col-start-1 row-start-1 flex', pending && cn('opacity-0', delayed))}>
        {children}
      </span>
      <LoaderCircle
        aria-hidden="true"
        size={size}
        className={cn(
          'col-start-1 row-start-1',
          pending ? cn('motion-safe:animate-spin', delayed) : 'opacity-0',
        )}
      />
    </span>
  );
}
