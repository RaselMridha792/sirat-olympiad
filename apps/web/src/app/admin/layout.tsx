import {
  Award,
  BookOpen,
  ClipboardList,
  CreditCard,
  FileText,
  LayoutDashboard,
  Megaphone,
  ScrollText,
  Settings,
  Trophy,
  Truck,
  Users,
  UsersRound,
  Milestone,
  Gavel,
  BadgeCheck,
  type LucideIcon,
} from 'lucide-react';
import { Avatar, initialOf, type NavItem } from '@sirat/ui';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { I18nProvider } from '@/components/I18nProvider';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { NavShell } from '@/components/NavShell';
import { common } from '@/i18n/common';
import { adminShellMessages, type AdminShellMessages } from '@/i18n/messages/admin-shell';
import { getMessages } from '@/i18n/server';
import { canOpen } from '@/lib/access';
import { requireArea } from '@/lib/session';

/**
 * Sidebar links, shown to the roles that may open them (lib/access.ts). Hiding a link only shapes the UI: each
 * admin page checks access itself and each API endpoint has its own server guard. Screens that are not
 * built yet are not linked at all.
 */
const NAV: ReadonlyArray<{
  key: keyof AdminShellMessages['nav'];
  href: string;
  Icon: LucideIcon;
}> = [
  { key: 'dashboard', href: '/admin', Icon: LayoutDashboard },
  { key: 'users', href: '/admin/users', Icon: Users },
  { key: 'exams', href: '/admin/exams', Icon: FileText },
  { key: 'leaderboard', href: '/admin/leaderboard', Icon: Trophy },
  { key: 'ambassadors', href: '/admin/ambassadors', Icon: Award },
  { key: 'tasks', href: '/admin/tasks', Icon: ClipboardList },
  { key: 'teams', href: '/admin/teams', Icon: UsersRound },
  { key: 'rounds', href: '/admin/rounds', Icon: Milestone },
  { key: 'jury', href: '/admin/jury', Icon: Gavel },
  { key: 'certificates', href: '/admin/certificates', Icon: BadgeCheck },
  { key: 'announcements', href: '/admin/announcements', Icon: Megaphone },
  { key: 'payments', href: '/admin/payments', Icon: CreditCard },
  { key: 'settings', href: '/admin/settings', Icon: Settings },
  { key: 'book', href: '/admin/book', Icon: BookOpen },
  { key: 'bookOrders', href: '/admin/book-orders', Icon: Truck },
  { key: 'audit', href: '/admin/audit', Icon: ScrollText },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [user, { locale, m }, { m: c }] = await Promise.all([
    requireArea('admin'),
    getMessages(adminShellMessages),
    getMessages(common),
  ]);
  const items: NavItem[] = NAV.filter(({ href }) => canOpen(href, user.role)).map(
    ({ key, href, Icon }) => ({
      href,
      label: m.nav[key],
      icon: <Icon size={20} aria-hidden="true" />,
    }),
  );
  const roleLabel = c.roles[user.role];
  // Worked out here on the server: the browser may split a Bangla name differently.
  const userInitial = initialOf(user.name);

  return (
    <div lang={locale}>
      <I18nProvider value={{ locale, states: c.states }}>
        <NavShell
          brand={m.brand}
          title={m.topbarTitle}
          topbarTone="surface"
          topbar={
            <>
              <LanguageSwitch tone="surface" />
              <span aria-hidden="true" className="mx-1 hidden h-8 w-px bg-line sm:block" />
              <div className="flex items-center gap-2">
                <Avatar name={user.name} initial={userInitial} size="sm" />
                <div className="sr-only leading-tight sm:not-sr-only">
                  <p className="text-sm font-semibold text-ink">{user.name}</p>
                  <p className="text-xs text-ink-muted">{roleLabel}</p>
                </div>
              </div>
              <LogoutButton locale={locale} tone="surface" />
            </>
          }
          labels={{ nav: c.nav.main, openMenu: c.nav.openMenu, closeMenu: c.nav.closeMenu }}
          items={items}
          userName={user.name}
          userInitial={userInitial}
          userRole={roleLabel}
        >
          {children}
        </NavShell>
      </I18nProvider>
    </div>
  );
}
