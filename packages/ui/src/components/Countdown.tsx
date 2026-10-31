'use client';
import { useEffect, useState } from 'react';
import { formatCountdown } from '../countdown-format';

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

  return (
    <span aria-live="off" className="font-mono text-lg font-bold tabular-nums">
      {formatCountdown(left)}
    </span>
  );
}
