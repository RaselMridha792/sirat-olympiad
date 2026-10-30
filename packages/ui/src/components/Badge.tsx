import type { ReactNode } from 'react';
import { cn } from '../cn';
import { TONES, type Tone } from '../tones';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-3 py-1 text-xs font-semibold',
        TONES[tone].className,
      )}
    >
      {children}
    </span>
  );
}
