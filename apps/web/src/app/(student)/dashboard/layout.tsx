import { Home, User, BookOpen, Trophy, Award, Megaphone, Receipt, Users } from 'lucide-react';
import type { NavItem } from '@sirat/ui';
import { NavShell } from '@/components/NavShell';
import { getSession } from '@/lib/session';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession('student');
  const items: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: <Home size={20} /> },
    { href: '/dashboard/profile', label: 'My Profile', icon: <User size={20} /> },
    { href: '/dashboard/exam', label: 'My Exams', icon: <BookOpen size={20} /> },
    { href: '/dashboard/leaderboard', label: 'Leaderboard', icon: <Trophy size={20} /> },
    { href: '/dashboard/certificates', label: 'Certificates', icon: <Award size={20} /> },
    { href: '/dashboard/announcements', label: 'Announcements', icon: <Megaphone size={20} /> },
    { href: '/dashboard/payments', label: 'Payments', icon: <Receipt size={20} /> },
    // Only for users with the ambassador role (filter on the server, enforce in the API):
    { href: '/dashboard/ambassador', label: 'Ambassador Panel', icon: <Users size={20} /> },
  ];
  return (
    <NavShell brand="Sirat Olympiad" items={items} userName={user.name} userRole={user.role}>
      {children}
    </NavShell>
  );
}
