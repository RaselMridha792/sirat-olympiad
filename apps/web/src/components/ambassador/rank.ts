import type { AmbassadorOverview } from '@sirat/shared';

/**
 * The three situations the rank card must tell apart (never "top rank" by accident):
 * - 'unranked': no tier applies (no thresholds configured, or no rank data at all)
 * - 'top': the highest configured tier is reached, there is no next tier
 * - 'climbing': a next tier exists; this includes a brand-new ambassador with 0 points
 * Pure, for node --test.
 */
export type RankStanding =
  | { kind: 'unranked' }
  | { kind: 'top'; current: string }
  | {
      kind: 'climbing';
      current: string | null;
      next: string;
      floor: number;
      target: number;
      /** Points still needed (0 if the data is ahead of the tiers). */
      toNext: number;
      /** 0–100 inside the current tier. */
      percent: number;
    };

export function rankStanding(points: number, rank: AmbassadorOverview['rank']): RankStanding {
  if (rank.next) {
    const target = rank.next.minPoints;
    const floor = Math.min(rank.current?.minPoints ?? 0, target);
    const clamped = Math.min(Math.max(points, floor), target);
    const percent = target > floor ? Math.round(((clamped - floor) / (target - floor)) * 100) : 0;
    return {
      kind: 'climbing',
      current: rank.current?.name ?? null,
      next: rank.next.name,
      floor,
      target,
      toNext: Math.max(0, target - points),
      percent,
    };
  }
  if (rank.current) return { kind: 'top', current: rank.current.name };
  return { kind: 'unranked' };
}
