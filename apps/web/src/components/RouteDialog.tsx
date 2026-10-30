'use client';
import { startTransition, useOptimistic, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@sirat/ui';

/**
 * A modal whose open state lives in the URL (e.g. `?user=<id>`): the page renders it only while the
 * param is present, so it is open whenever it is mounted. Closing (button, Esc, backdrop) replaces
 * the URL with `closeHref`, the same list without the param, keeping the scroll position.
 * Open it with a replacing link too (`<Link replace scroll={false}>`): opening and closing then
 * swap one history entry. A pushed open would leave a second copy of the list behind each closed
 * dialog, and every copy is a Back press that seems to do nothing.
 * While that navigation is in flight the dialog is already shut (which also hands focus back to
 * the link that opened it); if the navigation is abandoned the URL still names the record, so the
 * dialog shows again. Plain props only: the Server Component page passes strings and rendered nodes.
 */
export function RouteDialog({
  title,
  closeLabel,
  closeHref,
  children,
}: {
  title: string;
  closeLabel: string;
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [closing, setClosing] = useOptimistic(false);

  return (
    <Dialog
      open={!closing}
      onClose={() =>
        startTransition(() => {
          setClosing(true);
          router.replace(closeHref, { scroll: false });
        })
      }
      title={title}
      closeLabel={closeLabel}
    >
      {children}
    </Dialog>
  );
}
