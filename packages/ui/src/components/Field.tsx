import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '../cn';

function describedBy(
  fieldId: string | undefined,
  error?: string,
  hint?: string,
): string | undefined {
  if (!fieldId) return undefined;
  const ids = [error ? `${fieldId}-error` : null, hint ? `${fieldId}-hint` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

function FieldMessages({
  fieldId,
  error,
  hint,
}: {
  fieldId?: string;
  error?: string;
  hint?: string;
}) {
  return (
    <>
      {hint ? (
        <p id={fieldId ? `${fieldId}-hint` : undefined} className="text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={fieldId ? `${fieldId}-error` : undefined}
          className="text-xs font-medium text-danger-strong"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
}

export function Field({ label, error, hint, icon, id, className, ...rest }: FieldProps) {
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
        {icon ? (
          <span aria-hidden="true" className="text-ink-faint">
            {icon}
          </span>
        ) : null}
        <input
          id={fieldId}
          {...rest}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(fieldId, error, hint)}
          className={cn(
            'w-full bg-transparent text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed disabled:text-ink-muted',
            className,
          )}
        />
      </div>
      <FieldMessages fieldId={fieldId} error={error} hint={hint} />
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  /** First, empty option (e.g. "Select…"). */
  placeholder?: string;
  error?: string;
  hint?: string;
}

export function SelectField({
  label,
  options,
  placeholder,
  error,
  hint,
  id,
  className,
  ...rest
}: SelectFieldProps) {
  const fieldId = id ?? rest.name;
  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <select
        id={fieldId}
        {...rest}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(fieldId, error, hint)}
        className={cn(
          'w-full rounded-control border bg-page px-4 py-3 text-ink outline-none focus:border-primary',
          error ? 'border-danger' : 'border-line',
          className,
        )}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldMessages fieldId={fieldId} error={error} hint={hint} />
    </div>
  );
}
