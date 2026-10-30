'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell, type NavItem } from '@sirat/ui';

/**
 * The nav item for the current path. A parent item (its href is a prefix of another item's href,
 * like /dashboard or /admin) matches only its own path; other items also match their sub-pages.
 * So a page that is not in the menu (e.g. the ambassador panel for a student) marks nothing as
 * current, instead of the dashboard home (the old sidebars matched the root item exactly too).
 */
function activeHrefFor(items: NavItem[], pathname: string): string {
  const isParent = (item: NavItem) =>
    items.some((other) => other !== item && other.href.startsWith(item.href + '/'));
  return (
    items.find(
      (item) => pathname === item.href || (!isParent(item) && pathname.startsWith(item.href + '/')),
    )?.href ?? ''
  );
}

/** Client wrapper: binds next/link + current path to the shared AppShell. */
export function NavShell({
  brand,
  items,
  userName,
  userInitial,
  userRole,
  title,
  topbar,
  topbarTone,
  labels,
  children,
}: {
  brand: string;
  items: NavItem[];
  userName: string;
  /** initialOf(userName), worked out by the server layout (see AppShell). */
  userInitial: string;
  userRole: string;
  title?: string;
  topbar?: React.ReactNode;
  topbarTone?: 'shell' | 'surface';
  labels?: { nav: string; openMenu: string; closeMenu: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <AppShell
      brand={brand}
      items={items}
      activeHref={activeHrefFor(items, pathname)}
      userName={userName}
      userInitial={userInitial}
      userRole={userRole}
      title={title}
      topbar={topbar}
      topbarTone={topbarTone}
      navLabel={labels?.nav}
      menuLabel={labels?.openMenu}
      closeMenuLabel={labels?.closeMenu}
      renderLink={(item, props) => (
        <Link key={item.href} href={item.href} {...props}>
          {item.icon}
          <span>{item.label}</span>
        </Link>
      )}
    >
      {children}
    </AppShell>
  );
}
