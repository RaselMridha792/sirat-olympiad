import { LayoutDashboard, Users, FileText, Trophy, Megaphone, Gavel, Wallet, Shield } from 'lucide-react';
import type { NavItem } from '@sirat/ui';
import { NavShell } from '@/components/NavShell';
import { getSession } from '@/lib/session';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession('admin'); // TODO: redirect unless role is admin/manager/jury (and 2FA for admin)
  const items: NavItem[] = [
    { href: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { href: '/admin/users', label: 'Users', icon: <Users size={20} /> },
    { href: '/admin/exams', label: 'Exams', icon: <FileText size={20} /> },
    { href: '/admin/leaderboard', label: 'Leaderboard', icon: <Trophy size={20} /> },
    { href: '/admin/jury', label: 'Jury Evaluation', icon: <Gavel size={20} /> },
    { href: '/admin/payments', label: 'Payments', icon: <Wallet size={20} /> },
    { href: '/admin/announcements', label: 'Announcements', icon: <Megaphone size={20} /> },
    { href: '/admin/audit', label: 'Audit Log', icon: <Shield size={20} /> },
  ];
  return (
    <NavShell brand="Sirat Admin" items={items} userName={user.name} userRole={user.role}>
      {children}
    </NavShell>
  );
}
