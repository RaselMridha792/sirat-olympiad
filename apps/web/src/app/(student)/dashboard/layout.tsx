import {
  BookOpen,
  Flag,
  Gift,
  Home,
  Medal,
  Megaphone,
  Trophy,
  User,
  Users,
  UsersRound,
} from 'lucide-react';
import { initialOf, type NavItem } from '@sirat/ui';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { I18nProvider } from '@/components/I18nProvider';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { NavShell } from '@/components/NavShell';
import { UserChip } from '@/components/student/UserChip';
import { common } from '@/i18n/common';
import { studentShellMessages } from '@/i18n/messages/student-shell';
import { getMessages } from '@/i18n/server';
import { canOpen } from '@/lib/access';
import { requireArea } from '@/lib/session';

/**
 * Student dashboard frame (old dashboard/layout.js + Sidebar.jsx + Dashboard.jsx): navy sidebar and
 * navy top bar with the language switch and the user chip. Links are filtered by role (lib/access.ts)
 * only to hide them; each page checks access itself and the API guards each route. Certificates and
 * payments are not built yet, so hidden.
 */
export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const [user, { locale, m }, { m: c }] = await Promise.all([
    requireArea('student'),
    getMessages(studentShellMessages),
    getMessages(common),
  ]);
  const items: NavItem[] = [
    { href: '/dashboard', label: m.nav.home, icon: <Home size={20} aria-hidden /> },
    { href: '/dashboard/profile', label: m.nav.profile, icon: <User size={20} aria-hidden /> },
    { href: '/dashboard/exam', label: m.nav.exams, icon: <BookOpen size={20} aria-hidden /> },
    { href: '/dashboard/book', label: m.nav.book, icon: <Gift size={20} aria-hidden /> },
    {
      href: '/dashboard/leaderboard',
      label: m.nav.leaderboard,
      icon: <Trophy size={20} aria-hidden />,
    },
    {
      href: '/dashboard/announcements',
      label: m.nav.announcements,
      icon: <Megaphone size={20} aria-hidden />,
    },
    { href: '/dashboard/round', label: m.nav.round, icon: <Flag size={20} aria-hidden /> },
    {
      href: '/dashboard/certificates',
      label: m.nav.certificates,
      icon: <Medal size={20} aria-hidden />,
    },
    { href: '/dashboard/team', label: m.nav.team, icon: <UsersRound size={20} aria-hidden /> },
    ...(canOpen('/dashboard/ambassador', user.role)
      ? [
          {
            href: '/dashboard/ambassador',
            label: m.nav.ambassador,
            icon: <Users size={20} aria-hidden />,
          },
        ]
      : []),
  ];
  return (
    <div lang={locale}>
      <I18nProvider value={{ locale, states: c.states }}>
        <NavShell
          brand={m.brand}
          title={m.topbarTitle}
          topbarTone="shell"
          topbar={
            <>
              <LanguageSwitch tone="shell" />
              <span aria-hidden="true" className="mx-1 hidden h-8 w-px bg-white/15 sm:block" />
              <UserChip name={user.name} label={m.userChip(user.name)} />
              <LogoutButton locale={locale} tone="shell" />
            </>
          }
          labels={{
            nav: c.nav.main,
            openMenu: c.nav.openMenu,
            closeMenu: c.nav.closeMenu,
            skip: c.nav.skip,
          }}
          items={items}
          userName={user.name}
          // Worked out here on the server: the browser may split a Bangla name differently.
          userInitial={initialOf(user.name)}
          userRole={c.roles[user.role]}
        >
          {children}
        </NavShell>
      </I18nProvider>
    </div>
  );
}
