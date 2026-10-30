import { cn } from '../cn';
import { Anchor, type LinkComponent } from '../link';

export interface TabItem {
  key: string;
  label: string;
  href: string;
}

/**
 * Segmented, link-based tabs (old round switcher: "ROUND 1 | ROUND 2 | ROUND 3").
 * Each tab is a URL, so the server renders the selected view and it works without JavaScript.
 */
export function Tabs({
  items,
  activeKey,
  label,
  linkAs: LinkEl = Anchor,
}: {
  items: TabItem[];
  activeKey: string;
  label: string;
  linkAs?: LinkComponent;
}) {
  return (
    <nav aria-label={label} className="max-w-full overflow-x-auto">
      <ul className="inline-flex gap-1 rounded-control border border-line bg-page p-1">
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <li key={item.key}>
              <LinkEl
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block whitespace-nowrap rounded-[10px] px-4 py-2 text-xs font-black uppercase transition-colors',
                  active ? 'bg-surface text-primary shadow-card' : 'text-ink-muted hover:text-ink',
                )}
              >
                {item.label}
              </LinkEl>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
