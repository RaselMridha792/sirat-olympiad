/*
 * Rule violations (owner Q4; EXAM-PLAN 3.15). A violation is leaving the exam (the window loses focus or the page is
 * hidden: a tab or app switch) or a developer-tools key. Leaving counts once until the page has focus again, and a
 * warning on screen does not pause counting. Reloading or closing the page and losing the network are not violations.
 * Pure (no DOM), so node --test covers every rule; ExamRoom wires the browser events to it.
 */

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const DEVTOOLS_LETTERS = new Set(['i', 'j', 'c']);

/** F12, Ctrl+Shift+I/J/C, and Cmd+Opt+I/J/C on a Mac. Opening the tools from the browser menu cannot be seen. */
export function isDevtoolsKey(e: KeyLike): boolean {
  if (e.key === 'F12') return true;
  const letter = e.key.length === 1 ? e.key.toLowerCase() : '';
  if (!DEVTOOLS_LETTERS.has(letter)) return false;
  return (e.ctrlKey && e.shiftKey && !e.metaKey) || (e.metaKey && e.altKey);
}

export type PageSignal = 'blur' | 'hidden' | 'focus' | 'visible' | 'unloading';

/**
 * Turns page signals into leave/return events. `active` is false before the start and once the exam has ended.
 * Returns 'leave' (a violation), 'return', or null.
 */
export class LeaveTracker {
  private away = false;
  private unloading = false;

  signal(kind: PageSignal, active: boolean): 'leave' | 'return' | null {
    if (kind === 'unloading') {
      this.unloading = true; // a reload or close: the blur that follows is not a violation
      return null;
    }
    if (kind === 'blur' || kind === 'hidden') {
      if (!active || this.unloading || this.away) return null;
      this.away = true;
      return 'leave';
    }
    if (!this.away) return null;
    this.away = false;
    return active ? 'return' : null;
  }
}
