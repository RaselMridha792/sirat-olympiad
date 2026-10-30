import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-primary-strong">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink md:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}
