import { Badge } from '@sirat/ui';
import type { Locale } from '@/i18n';
import { pick } from '@/i18n/messages';
import { demoBadgeMessages } from '@/i18n/messages/demo-badge';

/** Marks a demo row in an admin list (demo data); a real row gets nothing. */
export function DemoBadge({ demo, locale }: { demo: boolean; locale: Locale }) {
  if (!demo) return null;
  return <Badge tone="warning">{pick(demoBadgeMessages, locale).label}</Badge>;
}
