import Link from 'next/link';
import { Avatar } from '@sirat/ui';

/**
 * Top-bar user chip of the student dashboard (old Dashboard.jsx header, navy bar): initials avatar
 * plus the name, linking to the profile. The name is hidden on small screens, so the link carries
 * an accessible name (`label`) that starts with the visible text. No logout here: auth owns that.
 */
export function UserChip({
  name,
  label,
  href = '/dashboard/profile',
}: {
  name: string;
  label: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex items-center gap-2 rounded-control p-1 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:pr-3"
    >
      <Avatar name={name} size="sm" />
      <span className="hidden max-w-40 truncate sm:block">{name}</span>
    </Link>
  );
}
