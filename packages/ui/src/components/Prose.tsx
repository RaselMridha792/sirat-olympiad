import { cn } from '../cn';

/** One block of long-form text: an optional heading, paragraphs and a list. Plain strings only. */
export interface ProseSection {
  heading?: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
}

/**
 * Long-form text (legal pages, about) from structured data. Every string is rendered as text, never as HTML, so
 * no page needs dangerouslySetInnerHTML (RULEBOOK §18). Headings are h2: the page owns its h1.
 */
export function Prose({
  sections,
  className,
}: {
  sections: readonly ProseSection[];
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-8 text-ink', className)}>
      {sections.map((section, index) => (
        <section key={section.heading ?? index} className="flex flex-col gap-3">
          {section.heading ? (
            <h2 className="text-lg font-bold tracking-tight text-ink">{section.heading}</h2>
          ) : null}
          {section.paragraphs?.map((text) => (
            <p key={text} className="leading-relaxed text-ink-muted">
              {text}
            </p>
          ))}
          {section.bullets?.length ? (
            <ul className="list-disc space-y-1 pl-5 leading-relaxed text-ink-muted">
              {section.bullets.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}
