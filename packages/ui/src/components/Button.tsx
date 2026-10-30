import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover',
  secondary: 'bg-secondary text-white hover:bg-secondary-hover',
  outline: 'border border-line bg-surface text-ink hover:bg-page',
  ghost: 'text-ink hover:bg-page',
  danger: 'bg-danger text-white hover:opacity-90',
};
const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
};

/** Button look for elements that are not <button> (e.g. a next/link that acts as a call to action). */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
    variants[variant],
    sizes[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Shown while `loading`; pass a translated string. */
  loadingLabel?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  loadingLabel = 'Please wait…',
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
    >
      {loading ? loadingLabel : children}
    </button>
  );
}
