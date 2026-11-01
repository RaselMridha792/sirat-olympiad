/**
 * Dev-only mock switch. `?mock=empty|error|slow` previews a page's empty, error and loading states;
 * `?mock=leak` adds canary fields to student data for the render-level leak check
 * (scripts/check-pages.mjs); `?mock=launch` shows the pages the launch table marks `soon` as production
 * would (data/launch.ts). Pure (no Next imports) so node --test covers the production rule: in a
 * production build the parameter is ignored and the mock source is not even in the bundle
 * (scripts/assert-no-mock.mjs).
 */
export const MOCK_STATES = ['empty', 'error', 'slow', 'leak', 'launch'] as const;
export type MockState = (typeof MOCK_STATES)[number];

export function mockAllowed(nodeEnv: string | undefined): boolean {
  return nodeEnv !== 'production';
}

export function parseMockState(
  value: string | string[] | undefined,
  nodeEnv: string | undefined,
): MockState | null {
  if (!mockAllowed(nodeEnv)) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  return (MOCK_STATES as readonly string[]).includes(raw ?? '') ? (raw as MockState) : null;
}
