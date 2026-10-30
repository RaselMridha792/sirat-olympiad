import {
  Award,
  FileText,
  LayoutDashboard,
  Megaphone,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@sirat/shared';
import { Avatar, initialOf, type NavItem } from '@sirat/ui';
import { I18nProvider } from '@/components/I18nProvider';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { NavShell } from '@/components/NavShell';
import { common } from '@/i18n/common';
import { adminShellMessages, type AdminShellMessages } from '@/i18n/messages/admin-shell';
import { getMessages } from '@/i18n/server';
import { getSession } from '@/lib/session';

/**
 * Sidebar links per role (no `roles` = every role that reaches the admin area). Hiding a link only
 * shapes the UI: each admin route and API endpoint has its own server guard. Screens that are not
 * built yet (jury, payments, audit log) are not linked at all.
 */
const NAV: ReadonlyArray<{
  key: keyof AdminShellMessages['nav'];
  href: string;
  Icon: LucideIcon;
  roles?: readonly Role[];
}> = [
  { key: 'dashboard', href: '/admin', Icon: LayoutDashboard },
  { key: 'users', href: '/admin/users', Icon: Users, roles: ['admin'] },
  { key: 'exams', href: '/admin/exams', Icon: FileText, roles: ['admin'] },
  { key: 'leaderboard', href: '/admin/leaderboard', Icon: Trophy, roles: ['admin', 'manager'] },
  { key: 'ambassadors', href: '/admin/ambassadors', Icon: Award, roles: ['admin'] },
  { key: 'announcements', href: '/admin/announcements', Icon: Megaphone, roles: ['admin'] },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [user, { locale, m }, { m: c }] = await Promise.all([
    getSession('admin'),
    getMessages(adminShellMessages),
    getMessages(common),
  ]);
  const items: NavItem[] = NAV.filter(({ roles }) => !roles || roles.includes(user.role)).map(
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
