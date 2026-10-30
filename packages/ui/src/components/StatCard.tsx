import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Card } from './Card';

type Tone = 'brand' | 'secondary' | 'info' | 'success' | 'warning';
const tones: Record<Tone, string> = {
  brand: 'bg-primary-soft text-primary-strong',
  secondary: 'bg-secondary-soft text-secondary',
  info: 'bg-info-soft text-info-strong',
  success: 'bg-success-soft text-success-strong',
  warning: 'bg-warning-soft text-warning-strong',
};

/** Replaces old admin/components/StatCard.jsx. Pass the icon as a node (no icon lib dependency). */
export function StatCard({
  title,
  value,
  icon,
  hint,
  tone = 'brand',
}: {
  title: string;
  value: string | number;
  icon?: ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <Card className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-muted">{title}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-ink">{value}</p>
        {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
      </div>
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            'flex h-14 w-14 shrink-0 items-center justify-center rounded-control',
            tones[tone],
          )}
        >
          {icon}
        </div>
      ) : null}
    </Card>
  );
}
