'use client';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { Avatar } from './Avatar';

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

/**
 * Sidebar + top bar + content frame shared by the student dashboard and the admin dashboard.
 * Visual source: old dashboard/Sidebar/Sidebar.jsx, dashboard/Dashboard/Dashboard.jsx (navy top bar)
 * and admin/components/Sidebar.jsx + Header.jsx (white top bar): dark sidebar, rounded active item
 * with a right accent bar. The old emerald accent is the brand primary here (owner decision).
 * Navigation items arrive already filtered by role on the server; the sidebar only HIDES links,
 * real protection is the server guard on each route/API.
 */
export function AppShell({
  brand,
  items,
  activeHref,
  renderLink,
  userName,
  userRole,
  title,
  topbar,
  topbarTone = 'surface',
  navLabel = 'Main',
  menuLabel = 'Open menu',
  closeMenuLabel = 'Close menu',
  sidebarFooter,
  children,
}: {
  brand: string;
  items: NavItem[];
  activeHref: string;
  renderLink: (item: NavItem, props: NavLinkProps) => ReactNode;
  userName: string;
  userRole: string;
  title?: string;
  /** Right side of the top bar (language switch, user menu). */
  topbar?: ReactNode;
  /** 'shell' = navy bar (old student dashboard), 'surface' = white bar (old admin). */
  topbarTone?: 'shell' | 'surface';
  navLabel?: string;
  menuLabel?: string;
  closeMenuLabel?: string;
  sidebarFooter?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const dark = topbarTone === 'shell';
  return (
    <div className="min-h-screen bg-page xl:flex">
      {open ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-shell/40 backdrop-blur-sm xl:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        id={navId}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-screen w-64 flex-col overflow-y-auto bg-shell p-4 text-ink-faint transition-transform xl:sticky xl:top-0 xl:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-6 flex h-12 items-center gap-3 px-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-bold text-white">
            {brand.slice(0, 1)}
          </div>
          <span className="text-lg font-bold tracking-tight text-white">{brand}</span>
        </div>
        <nav aria-label={navLabel} className="flex-1 space-y-1">
          {items.map((item) => {
            const active = item.href === activeHref;
            return renderLink(item, {
              className: cn(
                'flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors',
                active
                  ? 'border-r-4 border-primary bg-white/10 font-semibold text-white [&_svg]:text-primary'
                  : 'hover:bg-white/5 hover:text-white',
              ),
              onClick: () => setOpen(false),
              ...(active ? { 'aria-current': 'page' as const } : {}),
            });
          })}
        </nav>
        {sidebarFooter}
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/5 bg-white/5 p-3">
          <Avatar name={userName} />
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-white">{userName}</p>
            <p className="text-[10px] uppercase tracking-wider">{userRole}</p>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'sticky top-0 z-20 flex h-16 items-center gap-3 border-b px-4 md:px-8',
            dark
              ? 'border-white/10 bg-shell text-white'
              : 'border-line bg-surface/90 text-ink backdrop-blur',
          )}
        >
          <button
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
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
