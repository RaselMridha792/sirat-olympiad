import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  icon?: ReactNode;
}

export function Field({ label, error, icon, id, className, ...rest }: FieldProps) {
  const fieldId = id ?? rest.name;
  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <div
        className={cn(
          'flex items-center gap-3 rounded-control border bg-page px-4 py-3 focus-within:border-primary',
          error ? 'border-danger' : 'border-line',
        )}
      >
        {icon ? <span className="text-ink-faint">{icon}</span> : null}
        <input
          id={fieldId}
          {...rest}
          aria-invalid={Boolean(error)}
          className={cn(
            'w-full bg-transparent text-ink outline-none placeholder:text-ink-faint',
            className,
          )}
        />
      </div>
      {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
    </div>
  );
}
