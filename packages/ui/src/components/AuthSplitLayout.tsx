import type { ReactNode } from 'react';

/**
 * Login / register / forgot-password frame.
 * Ported from the old login/page.jsx: dark brand panel on the left, form on the right,
 * stacked on mobile. Logic (fetch, tokens, storage) is NOT ported — only the look.
 */
export function AuthSplitLayout({
  brand,
  tagline,
  children,
}: {
  brand: string;
  tagline: string;
  children: ReactNode;
}) {
  return (
    <main id="main" className="flex min-h-screen w-full items-center justify-center bg-page p-4">
      <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-surface shadow-2xl md:min-h-[650px] md:flex-row">
        <div className="relative flex flex-col justify-center overflow-hidden bg-shell p-10 md:w-1/2">
          <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-shell-soft opacity-70" />
          <div className="absolute -bottom-36 -right-12 h-80 w-80 rounded-full bg-shell-soft opacity-70" />
          <div className="relative z-10 text-white md:ml-10">
            <h1 className="mb-2 text-4xl font-bold tracking-wide">WELCOME</h1>
            <h2 className="mb-4 text-xl font-medium text-accent">{brand}</h2>
            <p className="max-w-xs text-sm leading-relaxed text-white/80">{tagline}</p>
          </div>
        </div>
        <div className="flex flex-col justify-center p-8 md:w-1/2 md:p-14">
          <div className="mx-auto w-full max-w-md">{children}</div>
        </div>
      </div>
    </main>
  );
}
