import { ApiRequestError } from '../../lib/api.ts';

export type PointsProblem = 'stale' | 'badThresholds' | 'notAmbassador' | 'invalid' | 'failed';

const BY_CODE: Record<string, PointsProblem> = {
  stale: 'stale',
  bad_thresholds: 'badThresholds',
  not_ambassador: 'notAmbassador',
};

/** Which message a refused points change or adjustment gets (06-API "Ambassadors"). Pure, for node --test. */
export function pointsProblem(error: unknown): PointsProblem {
  if (!(error instanceof ApiRequestError)) return 'failed';
  const details = Array.isArray(error.body?.details) ? (error.body.details as unknown[]) : [];
  for (const code of details) {
    const problem = typeof code === 'string' ? BY_CODE[code] : undefined;
    if (problem) return problem;
  }
  return error.status === 400 ? 'invalid' : 'failed';
}

export interface ThresholdRow {
  name: string;
  minPoints: number;
}

/** The server's rule, checked before sending: the first rank starts at 0, minimums rise, names are distinct. */
export function thresholdsValid(rows: readonly ThresholdRow[]): boolean {
  if (rows.length === 0 || rows[0]!.minPoints !== 0) return false;
  const names = rows.map((r) => r.name.trim().toLowerCase());
  if (names.some((n) => n.length < 2 || n.length > 30) || new Set(names).size !== names.length)
    return false;
  return rows.every(
    (r, i) => Number.isInteger(r.minPoints) && (i === 0 || r.minPoints > rows[i - 1]!.minPoints),
  );
}
