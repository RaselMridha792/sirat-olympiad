import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Anchor, type LinkComponent } from '../link';
import { Button, buttonClasses } from './Button';

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Client-side callback pagination (for interactive widgets). Lists use LinkPagination. */
export function Pagination({
  page,
  totalPages,
  onChange,
  prevLabel = 'Prev',
  nextLabel = 'Next',
  summary,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  prevLabel?: string;
  nextLabel?: string;
  summary?: ReactNode;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-4 py-4">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <Chevron dir="left" />
        {prevLabel}
      </Button>
      <span className="text-sm font-semibold text-ink-muted">
        {summary ?? `${page} / ${totalPages}`}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        {nextLabel}
        <Chevron dir="right" />
      </Button>
    </div>
  );
}

/**
 * URL-based pagination for server-paged lists: every page is a link (?page=N), so the server renders
 * exactly one page and the browser never holds the whole list. `summary` is pre-formatted by the app
 * (e.g. "Page ১ of ৫").
 */
export function LinkPagination({
  page,
  totalPages,
  hrefFor,
  label,
  prevLabel,
  nextLabel,
  summary,
  linkAs: LinkEl = Anchor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  label: string;
  prevLabel: string;
  nextLabel: string;
  summary: ReactNode;
  linkAs?: LinkComponent;
}) {
  if (totalPages <= 1) return null;
  const base = buttonClasses({ variant: 'outline', size: 'sm' });
  const off = cn(base, 'pointer-events-none opacity-50');
  return (
    <nav aria-label={label} className="flex items-center justify-center gap-3 py-4">
      {page > 1 ? (
        <LinkEl href={hrefFor(page - 1)} rel="prev" className={base}>
          <Chevron dir="left" />
          {prevLabel}
        </LinkEl>
      ) : (
        <span aria-disabled="true" className={off}>
          <Chevron dir="left" />
          {prevLabel}
        </span>
      )}
      <span className="text-sm font-semibold text-ink-muted">{summary}</span>
      {page < totalPages ? (
        <LinkEl href={hrefFor(page + 1)} rel="next" className={base}>
          {nextLabel}
          <Chevron dir="right" />
        </LinkEl>
      ) : (
        <span aria-disabled="true" className={off}>
          {nextLabel}
          <Chevron dir="right" />
        </span>
      )}
    </nav>
  );
}
