import type { MyRound } from '@sirat/shared';

export type VideoWindow = 'open' | 'notYet' | 'closed';

/**
 * Whether the student can send or change the video now (core C6b): inside the window, with an entry still pending
 * or sent. The API decides again by its own clock; this only picks the page's text. Pure, for node --test.
 */
export function videoWindow(mine: MyRound, now: number = Date.now()): VideoWindow {
  const opens = mine.round.opensAt ? Date.parse(mine.round.opensAt) : null;
  const closes = mine.round.closesAt ? Date.parse(mine.round.closesAt) : null;
  if (opens === null || closes === null) return 'notYet';
  if (now < opens) return 'notYet';
  if (now >= closes) return 'closed';
  return mine.entryStatus === 'pending' || mine.entryStatus === 'submitted' ? 'open' : 'closed';
}
