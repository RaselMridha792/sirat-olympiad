import type { ReactNode } from 'react';

/** A plain state of the registration pages (closed, unavailable): a heading, a sentence and optional links. */
export function RegistrationNotice({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary-soft text-secondary"
      >
        {icon}
      </span>
      <h1 className="text-2xl font-bold text-ink">{title}</h1>
      <p className="text-sm text-ink-muted">{text}</p>
      {children ? <div className="mt-2 flex flex-wrap justify-center gap-3">{children}</div> : null}
    </div>
  );
}
