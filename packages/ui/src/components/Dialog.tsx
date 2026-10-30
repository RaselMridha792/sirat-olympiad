'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Accessible modal on the native <dialog> element (focus trap, Esc, backdrop from the browser).
 * Controlled: the app decides `open` (e.g. from a ?user=<id> search param) and handles onClose.
 */
export function Dialog({
  open,
  onClose,
  title,
  closeLabel,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(); // click on the backdrop
      }}
      className="m-auto w-[min(40rem,calc(100%-2rem))] rounded-card border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-shell/60 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="rounded-control p-2 text-ink-muted hover:bg-page hover:text-ink"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
      {footer ? <div className="border-t border-line px-6 py-4">{footer}</div> : null}
    </dialog>
  );
}
