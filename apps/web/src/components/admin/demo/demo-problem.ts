import {
  DEMO_REASON_LIMITS,
  DEMO_REFUSALS,
  type AdminDemoStatus,
  type ApiError,
  type DemoRefusal,
} from '@sirat/shared';

/*
 * The demo data card's rules, as the API checks them (06-API "Demo data"), and how its refusals are read. Pure, for
 * node --test. The card shows only its own bn/en texts.
 */

export type DemoProblem =
  DemoRefusal | 'twoFactor' | 'denied' | 'queue' | 'invalid' | 'busy' | 'network';

export interface Answer {
  status: number;
  body: ApiError | null;
}

const isRefusal = (v: unknown): v is DemoRefusal =>
  (DEMO_REFUSALS as readonly unknown[]).includes(v);

/** A failed load or removal request; null = no answer (network). */
export function demoProblem(answer: Answer | null): DemoProblem {
  if (!answer) return 'network';
  const { status, body } = answer;
  const details = Array.isArray(body?.details) ? (body.details as unknown[]) : [];
  if (status === 403 && body?.code === 'TWO_FACTOR_REQUIRED') return 'twoFactor';
  if (status === 401 || status === 403) return 'denied';
  if (status === 409 && isRefusal(details[0])) return details[0];
  if (status === 503 && details.includes('queue_unavailable')) return 'queue';
  if (status === 400 || status === 409) return 'invalid';
  return 'busy';
}

export function validDemoReason(input: string): boolean {
  const length = input.trim().replace(/\s+/g, ' ').length;
  return length >= DEMO_REASON_LIMITS.min && length <= DEMO_REASON_LIMITS.max;
}

/** A load or a removal is running: the card asks the API again until it ends. An abandoned job is not running. */
export const demoRunning = (s: AdminDemoStatus): boolean =>
  (s.batch?.status === 'loading' || s.batch?.status === 'clearing') && !s.batch.stale;

/** The removal is offered for a loaded or failed batch, and for one whose job was abandoned (DEMO_STALE_MINUTES). */
export const demoRemovable = (s: AdminDemoStatus): boolean =>
  s.batch !== null && (s.batch.status === 'loaded' || s.batch.status === 'failed' || s.batch.stale);

/** The counts to show, in a fixed order first, then anything an area added later (by its table name). */
export function demoCountRows(counts: Record<string, number>, order: readonly string[]) {
  const known = order.filter((k) => typeof counts[k] === 'number');
  const rest = Object.keys(counts)
    .filter((k) => !order.includes(k) && typeof counts[k] === 'number')
    .sort();
  return [...known, ...rest].map((key) => ({ key, value: counts[key]! }));
}
