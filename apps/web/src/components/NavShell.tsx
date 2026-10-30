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
  children,
}: {
  brand: string;
  items: NavItem[];
  userName: string;
  userRole: string;
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
      renderLink={(item, className, onClick) => (
        <Link key={item.href} href={item.href} className={className} onClick={onClick}>
          {item.icon}
          <span>{item.label}</span>
        </Link>
      )}
    >
      {children}
    </AppShell>
  );
}
