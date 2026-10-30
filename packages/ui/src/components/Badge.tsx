import type { ReactNode } from 'react';
import { cn } from '../cn';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';
const tones: Record<Tone, string> = {
  neutral: 'bg-page text-ink-muted',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  brand: 'bg-primary-soft text-primary',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex rounded-full px-3 py-1 text-xs font-semibold', tones[tone])}>
      {children}
    </span>
  );
}
