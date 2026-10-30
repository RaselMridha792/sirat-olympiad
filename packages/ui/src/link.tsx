import type { ComponentType, ReactNode } from 'react';

/**
 * Minimal link contract so server-rendered navigation (tabs, pagination) can use next/link
 * without the ui package depending on Next. Apps pass `linkAs={Link}`; the default is a plain <a>.
 */
export interface LinkLikeProps {
  href: string;
  className?: string;
  children?: ReactNode;
  rel?: string;
  prefetch?: boolean;
  'aria-current'?: 'page';
  'aria-label'?: string;
}

export type LinkComponent = ComponentType<LinkLikeProps>;

export function Anchor({ prefetch, ...rest }: LinkLikeProps) {
  void prefetch; // only meaningful for next/link
  return <a {...rest} />;
}
