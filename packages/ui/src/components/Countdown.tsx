'use client';
import { useEffect, useState } from 'react';

/**
 * DISPLAY-ONLY countdown. `remainingSeconds` MUST come from the server (see docs/03-HOW-IT-WORKS.md).
 * The component counts down locally for smoothness and re-syncs whenever the prop changes
 * (every checkpoint response). It never decides whether time is up — the server does.
 */
export function Countdown({
  remainingSeconds,
  onZero,
}: {
  remainingSeconds: number;
  onZero?: () => void;
}) {
  const [left, setLeft] = useState(Math.max(0, Math.floor(remainingSeconds)));

  useEffect(() => {
    setLeft(Math.max(0, Math.floor(remainingSeconds)));
  }, [remainingSeconds]);

  useEffect(() => {
    if (left <= 0) {
      onZero?.();
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onZero]);

  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <span aria-live="off" className="font-mono text-lg font-bold tabular-nums">
      {mm}:{ss}
    </span>
  );
}
