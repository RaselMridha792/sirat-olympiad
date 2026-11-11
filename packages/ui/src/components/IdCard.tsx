import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface IdCardField {
  label: string;
  value: string;
  /** Codes and IDs: monospaced and spaced, so they read and copy unambiguously. */
  mono?: boolean;
}

export interface IdCardProps {
  /** The card's accessible name, e.g. "Ambassador ID card". */
  label: string;
  /** The brand mark (the app passes its own image). */
  mark: ReactNode;
  /** The organisation, beside the mark. */
  org: string;
  /** What the card makes its holder, e.g. "Ambassador": in the accent colour above the name. */
  role: string;
  name: string;
  fields: IdCardField[];
  footer?: ReactNode;
  className?: string;
}

/**
 * A wallet-sized identity card: the brand mark and organisation on the dark brand band, the role, the holder's name
 * and labelled fields. Text only, no photo, so it reads the same on screen, in print and to a screen reader. The
 * `print-card` class lets an app print just this card (apps/web globals.css).
 */
export function IdCard({ label, mark, org, role, name, fields, footer, className }: IdCardProps) {
  return (
    <section
      aria-label={label}
      className={cn(
        'print-card relative w-full max-w-md overflow-hidden rounded-3xl bg-shell p-6 text-white shadow-card',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/5"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -left-10 h-44 w-44 rounded-full bg-white/5"
      />
      <div className="relative flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-1">
          {mark}
        </span>
        <p className="min-w-0 text-sm font-bold leading-tight">{org}</p>
      </div>
      <p className="relative mt-6 text-xs font-black uppercase tracking-widest text-accent">
        {role}
      </p>
      <p className="relative mt-1 break-words text-2xl font-black leading-tight">{name}</p>
      <dl className="relative mt-5 grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-xs font-bold uppercase tracking-wider text-white/70">{f.label}</dt>
            <dd
              className={cn(
                'mt-1 break-all text-base font-bold',
                f.mono && 'font-mono tracking-widest',
              )}
            >
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
      {footer ? (
        <div className="relative mt-5 border-t border-white/10 pt-3 text-xs text-white/70">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
