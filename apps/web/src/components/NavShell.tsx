'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell, type NavItem } from '@sirat/ui';

/** Client wrapper: binds next/link + current path to the shared AppShell. */
export function NavShell({
  brand,
  items,
  userName,
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
  userRole: string;
  title?: string;
  topbar?: React.ReactNode;
  topbarTone?: 'shell' | 'surface';
  labels?: { nav: string; openMenu: string; closeMenu: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active =
    [...items]
      .sort((a, b) => b.href.length - a.href.length)
      .find((i) => pathname === i.href || pathname.startsWith(i.href + '/'))?.href ?? '';
  return (
    <AppShell
      brand={brand}
      items={items}
      activeHref={active}
      userName={userName}
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
