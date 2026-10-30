import type { ReactNode } from 'react';
import { Card } from './Card';

/** Replaces old admin/components/StatCard.jsx. Pass the icon as a node (no icon lib dependency). */
export function StatCard({
  title,
  value,
  icon,
  hint,
}: {
  title: string;
  value: string | number;
  icon?: ReactNode;
  hint?: string;
}) {
  return (
    <Card className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-ink-muted">{title}</p>
        <p className="mt-1 text-3xl font-bold text-ink">{value}</p>
        {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
      </div>
      {icon ? (
        <div className="flex h-14 w-14 items-center justify-center rounded-control bg-primary-soft text-primary">
          {icon}
        </div>
      ) : null}
    </Card>
  );
}
