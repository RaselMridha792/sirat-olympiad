'use client';
import { useState, type ReactNode } from 'react';
import { cn } from '../cn';

export interface NavItem {
  href: string;
  label: string;
  icon?: ReactNode;
}

/**
 * Sidebar + content frame shared by the student dashboard and the admin dashboard.
 * Visual source: old admin/components/Sidebar.jsx and dashboard/Sidebar/Sidebar.jsx
 * (dark #0f172a sidebar, rounded active item). Navigation items are passed in by the app,
 * already filtered by role on the server. `renderLink` lets the app plug in next/link.
 * The sidebar only HIDES links; real protection is the server guard on each route/API.
 */
export function AppShell({
  brand,
  items,
  activeHref,
  renderLink,
  userName,
  userRole,
  children,
}: {
  brand: string;
  items: NavItem[];
  activeHref: string;
  renderLink: (item: NavItem, className: string, onClick: () => void) => ReactNode;
  userName: string;
  userRole: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-page xl:flex">
      <button
        type="button"
        aria-label="Toggle menu"
        onClick={() => setOpen((v) => !v)}
        className="fixed left-4 top-4 z-[60] rounded-control bg-surface px-3 py-2 text-sm font-semibold shadow-card xl:hidden"
      >
        Menu
      </button>
      {open ? (
        <div className="fixed inset-0 z-30 bg-black/50 xl:hidden" onClick={() => setOpen(false)} />
      ) : null}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-screen w-64 flex-col overflow-auto bg-shell p-4 text-ink-faint transition-transform xl:sticky xl:top-0 xl:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-8 flex h-16 items-center gap-3 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-white">
            S
          </div>
          <span className="text-lg font-bold tracking-tight text-white">{brand}</span>
        </div>
        <nav className="flex-1 space-y-1">
          {items.map((item) =>
            renderLink(
              item,
              cn(
                'flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors',
                item.href === activeHref
                  ? 'bg-white/10 font-semibold text-white'
                  : 'hover:bg-white/5 hover:text-white',
              ),
              () => setOpen(false),
            ),
          )}
        </nav>
        <div className="mt-auto flex items-center gap-3 rounded-2xl border border-white/5 bg-white/5 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary font-bold text-white">
            {userName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-white">{userName}</p>
            <p className="text-[10px] uppercase tracking-wider">{userRole}</p>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 pt-16 md:p-8 xl:pt-8">{children}</main>
    </div>
  );
}
