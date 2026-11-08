import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface AccordionItem {
  id: string;
  question: string;
  answer: ReactNode;
}

/**
 * Questions and answers as native <details>/<summary>: keyboard, screen readers and find-in-page work without any
 * script, so it renders on the server. `name` makes the group exclusive (one open at a time) where the browser
 * supports it; elsewhere each item opens on its own.
 */
export function Accordion({
  items,
  name,
  className,
}: {
  items: readonly AccordionItem[];
  name?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card',
        className,
      )}
    >
      {items.map((item) => (
        <details key={item.id} id={item.id} name={name} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-start font-semibold text-ink hover:bg-page focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-strong md:px-6 [&::-webkit-details-marker]:hidden">
            <span>{item.question}</span>
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 20 20"
              className="h-5 w-5 shrink-0 text-ink-faint group-open:rotate-180 motion-safe:transition-transform"
            >
              <path
                d="M5 7.5l5 5 5-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </summary>
          <div className="px-5 pb-5 leading-relaxed text-ink-muted md:px-6">{item.answer}</div>
        </details>
      ))}
    </div>
  );
}
