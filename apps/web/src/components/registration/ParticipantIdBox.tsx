'use client';
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { formatParticipantId } from '@sirat/shared';

type CopyState = 'idle' | 'copied' | 'failed';
const RESET_MS = 2000;

/**
 * The new participant ID on the result page (DECISIONS "The participant ID"): shown grouped for reading, copied in the
 * canonical form. The result is announced through a polite live region; a failed copy tells the student to select
 * the ID by hand, and that text stays (WCAG 2.2.1). Nothing is stored or logged.
 */
export function ParticipantIdBox({
  participantId,
  title,
  note,
  copyLabel,
  copiedLabel,
  failedLabel,
}: {
  participantId: string;
  title: string;
  note: string;
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
      // navigator.clipboard is missing outside secure contexts; the throw lands in the catch.
      await navigator.clipboard.writeText(participantId);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  const copied = state === 'copied';
  return (
    <section
      aria-labelledby="participant-id-title"
      className="w-full rounded-card border border-line bg-page p-4 text-center"
    >
      <h2 id="participant-id-title" className="text-sm font-medium text-ink-muted">
        {title}
      </h2>
      <p
        className="mt-1 select-all font-mono text-xl font-semibold tracking-wider text-ink"
        translate="no"
      >
        {formatParticipantId(participantId)}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-2 inline-flex items-center gap-2 rounded-control border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        <span>{copied ? copiedLabel : copyLabel}</span>
      </button>
      <p
        role="status"
        aria-live="polite"
        className={state === 'failed' ? 'mt-1 text-xs text-ink-muted' : 'sr-only'}
      >
        {copied ? copiedLabel : state === 'failed' ? failedLabel : ''}
      </p>
      <p className="mt-2 text-xs text-ink-muted">{note}</p>
    </section>
  );
}
