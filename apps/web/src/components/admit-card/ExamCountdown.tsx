'use client';
import { useEffect, useState } from 'react';
import { countdownParts, SECOND } from './countdown.ts';

/**
 * The countdown to the exam's start (the client's mock-up): days, hours, minutes and seconds in boxes, ticking once a
 * second. Display only: the server decides when an exam opens. The boxes are hidden from screen readers (a tick
 * every second would be noise); a fixed sentence with the start time says the same thing once.
 */
export function ExamCountdown({
  startsAt,
  numberLocale,
  units,
  startsAtText,
  startedText,
}: {
  startsAt: string;
  /** The Intl tag for the digits (bn-BD gives Bangla digits). */
  numberLocale: string;
  units: { days: string; hours: string; minutes: string; seconds: string };
  startsAtText: string;
  startedText: string;
}) {
  const target = new Date(startsAt).getTime();
  // Rendered on the server with the target itself, so the first paint never shows a wrong time: the client fills in.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, SECOND);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const parts = countdownParts(target, now ?? target);
  if (now !== null && parts.done)
    return <p className="text-sm font-semibold text-primary-strong">{startedText}</p>;
  const two = new Intl.NumberFormat(numberLocale, { minimumIntegerDigits: 2, useGrouping: false });
  const boxes = [
    [parts.days, units.days],
    [parts.hours, units.hours],
    [parts.minutes, units.minutes],
    [parts.seconds, units.seconds],
  ] as const;
  return (
    <>
      <p className="sr-only">{startsAtText}</p>
      <div aria-hidden="true" className="grid grid-cols-4 gap-2">
        {boxes.map(([value, label]) => (
          <div key={label} className="text-center">
            <span className="flex h-14 items-center justify-center rounded-card border border-line bg-surface font-mono text-2xl font-black tabular-nums text-primary-strong shadow-card">
              {now === null ? '--' : two.format(value)}
            </span>
            <span className="mt-1 block text-xs text-ink-muted">{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}
