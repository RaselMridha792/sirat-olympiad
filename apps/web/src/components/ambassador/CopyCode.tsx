'use client';
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

type CopyState = 'idle' | 'copied' | 'failed';
const RESET_MS = 2000;

/**
 * Copies the promo code to the clipboard. The result is announced through a polite live region;
 * nothing is stored. "Copied" goes back to the normal label after two seconds. A failure tells
 * the user what to do instead (select the code, which is select-all, and copy it by hand), so
 * that text stays until the next click (WCAG 2.2.1). All labels arrive translated from the
 * server (plain strings only). Styled for the dark ambassador hero.
 */
export function CopyCode({
  code,
  label,
  copiedLabel,
  failedLabel,
}: {
  code: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    // Only success resets itself; the failure instruction must stay readable.
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState('idle'), RESET_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      // navigator.clipboard is missing outside secure contexts; the throw lands in the catch.
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  const copied = state === 'copied';
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-2 rounded-control bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        <span>{copied ? copiedLabel : label}</span>
      </button>
      <p
        role="status"
        aria-live="polite"
        className={state === 'failed' ? 'max-w-60 text-xs text-white/80' : 'sr-only'}
      >
        {copied ? copiedLabel : state === 'failed' ? failedLabel : ''}
      </p>
    </div>
  );
}
