import type { ReactNode } from 'react';
import { cn } from '../cn';
import { buttonClasses } from './Button';

/**
 * GET search form: the query lands in the URL and the SERVER filters and pages.
 * Works without JavaScript. `preserve` keeps other params (e.g. the selected round); the page
 * number is intentionally dropped so a new search starts at page 1.
 */
export function SearchBox({
  id = 'search',
  name = 'q',
  defaultValue,
  label,
  placeholder,
  submitLabel,
  action,
  preserve = {},
  icon,
  className,
}: {
  id?: string;
  name?: string;
  defaultValue?: string;
  label: string;
  placeholder?: string;
  submitLabel: string;
  action?: string;
  preserve?: Record<string, string | undefined>;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <form
      role="search"
      method="get"
      action={action}
      className={cn('flex w-full items-center gap-2 sm:w-auto', className)}
    >
      {Object.entries(preserve).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 focus-within:border-primary sm:w-72 sm:flex-none">
        {icon ? (
          <span aria-hidden="true" className="text-ink-faint">
            {icon}
          </span>
        ) : null}
        <input
          id={id}
          name={name}
          type="search"
          defaultValue={defaultValue}
          placeholder={placeholder}
          maxLength={100}
          className="w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
      <button type="submit" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
        {submitLabel}
      </button>
    </form>
  );
}
