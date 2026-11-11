'use client';
import { useEffect, useState } from 'react';
import { Check, Copy, ShieldAlert } from 'lucide-react';
import { formatParticipantId } from '@sirat/shared';

type CopyState = 'idle' | 'copied' | 'failed';
const RESET_MS = 2000;

/**
 * The participant ID on the admit card: the one place it shows in full (it is the login secret, with the email).
 * Grouped for reading, copied in the canonical form, with the keep-private note. The copy result is announced
 * politely; a failed copy says to select the ID by hand. Nothing is stored or logged.
 */
export function AdmitIdBox({
  participantId,
  label,
  registered,
  keepPrivate,
  copyLabel,
  copiedLabel,
  failedLabel,
}: {
  participantId: string;
  label: string;
  registered: string;
  keepPrivate: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState('idle'), RESET_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(participantId);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  const copied = state === 'copied';
  return (
    <section
      aria-labelledby="admit-id-label"
      className="rounded-card border border-primary/30 bg-primary-soft p-5"
    >
      <h2 id="admit-id-label" className="text-xs font-semibold text-ink-muted">
        {label}
      </h2>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p
          className="select-all break-all font-mono text-2xl font-black tracking-wider text-primary-strong sm:text-3xl"
          translate="no"
        >
          {formatParticipantId(participantId)}
        </p>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex min-h-9 items-center gap-2 rounded-control bg-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          <span>{copied ? copiedLabel : copyLabel}</span>
        </button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={state === 'failed' ? 'mt-1 text-xs text-ink-muted' : 'sr-only'}
      >
        {copied ? copiedLabel : state === 'failed' ? failedLabel : ''}
      </p>
      <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-primary-strong">
        <Check size={16} aria-hidden="true" />
        {registered}
      </p>
      <p className="mt-3 flex gap-2 rounded-control bg-surface/70 p-3 text-xs text-ink">
        <ShieldAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning-strong" />
        <span>{keepPrivate}</span>
      </p>
    </section>
  );
}
