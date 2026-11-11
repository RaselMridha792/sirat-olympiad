/** One rank threshold (rank_thresholds): a name and the points it starts at. */
export interface Rank {
  name: string;
  minPoints: number;
}

/**
 * The highest threshold at or below the points, and the next one up (thresholds are data, RULEBOOK §19). Its own
 * file, so the panel and the leaderboard both use it without importing each other.
 */
export function rankOf(
  points: number,
  thresholds: Rank[],
): { current: Rank | null; next: Rank | null } {
  const sorted = [...thresholds].sort((a, b) => a.minPoints - b.minPoints);
  let current: Rank | null = null;
  let next: Rank | null = null;
  for (const t of sorted) {
    if (t.minPoints <= points) current = t;
    else if (!next) next = t;
  }
  return { current, next };
}
