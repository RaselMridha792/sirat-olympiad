import type { ReactNode } from 'react';
import { cn } from '../cn';
import { StarMark } from './Pattern';

export type SectionSurface = 'page' | 'surface' | 'tint' | 'shell';

// Each surface with the text colours that stay readable on it (contrast.test.ts checks the pairs).
const surfaces: Record<SectionSurface, { section: string; kicker: string; lead: string }> = {
  page: { section: 'bg-page text-ink', kicker: 'text-primary-strong', lead: 'text-ink-muted' },
  surface: {
    section: 'bg-surface text-ink',
    kicker: 'text-primary-strong',
    lead: 'text-ink-muted',
  },
  tint: {
    section: 'bg-secondary-soft text-ink',
    kicker: 'text-primary-strong',
    lead: 'text-ink-muted',
  },
  shell: { section: 'bg-shell text-white', kicker: 'text-primary', lead: 'text-white/75' },
};

/**
 * One full-width band of a long public page: a kicker, an h2 and a lead, then the content. Alternate the surfaces
 * from band to band. `id` is the in-page anchor (#id) and names the heading for aria-labelledby. `decoration` (a
 * <GeometricPattern>, say) is drawn behind the content.
 */
export function Section({
  id,
  kicker,
  title,
  lead,
  surface = 'page',
  align = 'center',
  decoration,
  children,
  className,
}: {
  id: string;
  kicker?: string;
  title: ReactNode;
  lead?: ReactNode;
  surface?: SectionSurface;
  align?: 'center' | 'start';
  decoration?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const tone = surfaces[surface];
  const titleId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(
        'relative isolate scroll-mt-4 overflow-hidden px-4 py-16 sm:px-6 md:py-24',
        tone.section,
        className,
      )}
    >
      {decoration}
      <div className="mx-auto max-w-6xl">
        <header className={cn('max-w-3xl', align === 'center' && 'mx-auto text-center')}>
          {kicker ? (
            <p
              className={cn(
                'inline-flex items-center gap-2 text-sm font-bold',
                tone.kicker,
                align === 'center' && 'justify-center',
              )}
            >
              <StarMark className="h-3.5 w-3.5" />
              {kicker}
            </p>
          ) : null}
          <h2
            id={titleId}
            className="mt-3 text-3xl leading-snug font-extrabold text-balance md:text-4xl"
          >
            {title}
          </h2>
          {lead ? (
            <p className={cn('mt-4 text-lg leading-relaxed text-pretty', tone.lead)}>{lead}</p>
          ) : null}
        </header>
        {children ? <div className="mt-10 md:mt-14">{children}</div> : null}
      </div>
    </section>
  );
}
