'use client';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { initialOf } from '../text';
import { Avatar } from './Avatar';
import { SkipLink } from './SkipLink';

export interface NavItem {
  href: string;
  label: string;
  icon?: ReactNode;
}

export interface NavLinkProps {
  className: string;
  onClick: () => void;
  'aria-current'?: 'page';
}

/** What can take focus inside the drawer's nav (renderLink decides the element). */
const FOCUSABLE = 'a[href], button:not([disabled])';

/**
 * Sidebar + top bar + content frame shared by the student dashboard and the admin dashboard.
 * Visual source: old dashboard/Sidebar/Sidebar.jsx, dashboard/Dashboard/Dashboard.jsx (navy top bar)
 * and admin/components/Sidebar.jsx + Header.jsx (white top bar): dark sidebar, rounded active item
 * with a right accent bar. The old emerald accent is the brand primary here (owner decision).
 * Navigation items arrive already filtered by role on the server; the sidebar only HIDES links,
 * real protection is the server guard on each route/API.
 *
 * Below xl the sidebar is a drawer. Closed, it is off-screen and invisible, so its links are out of
 * the tab order and the accessibility tree. Open, the rest of the page is inert and focus moves to
 * the first link; the close button, Escape or a click on the overlay closes it and puts focus back
 * on the menu button.
 */
export function AppShell({
  brand,
  items,
  activeHref,
  renderLink,
  userName,
  userInitial,
  userRole,
  title,
  topbar,
  topbarTone = 'surface',
  navLabel = 'Main',
  menuLabel = 'Open menu',
  closeMenuLabel = 'Close menu',
  skipLabel,
  sidebarFooter,
  children,
}: {
  /** Product name in Latin script (both languages), so its tile letter is the same everywhere. */
  brand: string;
  items: NavItem[];
  activeHref: string;
  renderLink: (item: NavItem, props: NavLinkProps) => ReactNode;
  userName: string;
  /**
   * initialOf(userName), worked out on the server. This is a client component, and the browser
   * may segment a Bangla name differently from the server, which would break hydration.
   */
  userInitial: string;
  userRole: string;
  title?: string;
  /** Right side of the top bar (language switch, user menu). */
  topbar?: ReactNode;
  /** 'shell' = navy bar (old student dashboard), 'surface' = white bar (old admin). */
  topbarTone?: 'shell' | 'surface';
  navLabel?: string;
  menuLabel?: string;
  closeMenuLabel?: string;
  /** "Skip to main content", translated by the app; without it no skip link renders. */
  skipLabel?: string;
  sidebarFooter?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navId = useId();
  const navRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const refocusOnClose = useRef(false);

  /** Escape, overlay click, close button: close the drawer and return focus to the menu button. */
  const closeAndRefocus = useCallback(() => {
    refocusOnClose.current = true;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) {
      // After the commit, so the content column is no longer inert and the button can take focus.
      if (refocusOnClose.current) menuButtonRef.current?.focus();
      refocusOnClose.current = false;
      return;
    }
    // The drawer turns visible in the same render (see the aside classes), so it can take focus.
    navRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndRefocus();
    };
    // Growing to xl turns the drawer into the fixed sidebar: close it, or the content stays inert.
    const desktop = window.matchMedia('(min-width: 80rem)');
    const onDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    desktop.addEventListener('change', onDesktop);
    return () => {
      window.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onDesktop);
    };
  }, [open, closeAndRefocus]);

  const dark = topbarTone === 'shell';
  return (
    <div className="min-h-screen bg-page xl:flex">
      {skipLabel ? <SkipLink>{skipLabel}</SkipLink> : null}
      {open ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-shell/40 backdrop-blur-sm xl:hidden"
          onClick={closeAndRefocus}
        />
      ) : null}
      <aside
        id={navId}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-screen w-64 flex-col overflow-y-auto bg-shell p-4 text-white/70 xl:visible xl:sticky xl:top-0 xl:translate-x-0',
          // Visibility animates only when closing (the drawer stays visible while it slides out).
          // When opening it switches at once, so focus can move into the drawer straight away.
          // Tailwind's translate-x-* set the `translate` property, hence transition-[translate].
          open
            ? 'translate-x-0 motion-safe:transition-[translate]'
            : '-translate-x-full max-xl:invisible motion-safe:transition-[translate,visibility]',
        )}
      >
        <div className="mb-6 flex h-12 items-center gap-3 px-3">
          <div
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-strong font-bold text-white"
          >
            {initialOf(brand)}
          </div>
          <span className="text-lg font-bold tracking-tight text-white">{brand}</span>
          <button
            type="button"
            onClick={closeAndRefocus}
            aria-label={closeMenuLabel}
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-control text-white/70 hover:bg-white/10 hover:text-white xl:hidden"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <nav ref={navRef} aria-label={navLabel} className="flex-1 space-y-1">
          {items.map((item) => {
            const active = item.href === activeHref;
            return renderLink(item, {
              className: cn(
                'flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors',
                active
                  ? 'border-r-4 border-accent bg-white/10 font-semibold text-white [&_svg]:text-accent'
                  : 'hover:bg-white/5 hover:text-white',
              ),
              onClick: () => setOpen(false),
              ...(active ? { 'aria-current': 'page' as const } : {}),
            });
          })}
        </nav>
        {sidebarFooter}
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/5 bg-white/5 p-3">
          <Avatar name={userName} initial={userInitial} />
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-white">{userName}</p>
            <p className="text-[10px] uppercase tracking-wider text-white/60">{userRole}</p>
          </div>
        </div>
      </aside>
      {/* While the drawer is open (below xl only) the page behind the overlay is inert, so Tab
          stays in the drawer; the close button inside it, Escape and the overlay close it. */}
      <div className="flex min-w-0 flex-1 flex-col" inert={open}>
        <header
          className={cn(
            'sticky top-0 z-20 flex h-16 items-center gap-3 border-b px-4 md:px-8',
            dark
              ? 'border-white/10 bg-shell text-white'
              : 'border-line bg-surface/90 text-ink backdrop-blur',
          )}
        >
          <button
            ref={menuButtonRef}
            type="button"
            aria-controls={navId}
            aria-expanded={open}
            aria-label={open ? closeMenuLabel : menuLabel}
            onClick={() => setOpen((v) => !v)}
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-control xl:hidden',
              dark
                ? 'bg-white/10 hover:bg-white/20'
                : 'border border-line bg-surface hover:bg-page',
            )}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          {title ? <p className="truncate text-base font-bold">{title}</p> : null}
          <div className="ml-auto flex items-center gap-2">{topbar}</div>
        </header>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
