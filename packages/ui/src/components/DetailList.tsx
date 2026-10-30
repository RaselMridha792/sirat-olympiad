import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface DetailItem {
  label: string;
  value: ReactNode;
}

/**
 * Label/value tiles (old profile "Personal Info" grid: 10px caps label, bold value).
 * Used by the student profile and the admin user details.
 */
export function DetailList({ items, columns = 2 }: { items: DetailItem[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl
      className={cn(
        'grid gap-3',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="rounded-control border border-line bg-page px-4 py-3">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            {item.label}
          </dt>
          <dd className="mt-1 break-words text-sm font-semibold text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
