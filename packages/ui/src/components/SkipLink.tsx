/**
 * The first focusable element of a page frame (WCAG 2.4.1): hidden until a keyboard user reaches it, then it jumps
 * past the header and navigation to the page's `main#main`. The label comes translated from the app.
 */
export function SkipLink({ href = '#main', children }: { href?: string; children: string }) {
  return (
    <a
      href={href}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-control focus:bg-surface focus:px-4 focus:py-3 focus:font-semibold focus:text-ink focus:shadow-card focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong"
    >
      {children}
    </a>
  );
}
