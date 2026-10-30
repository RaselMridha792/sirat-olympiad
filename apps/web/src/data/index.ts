import { connection } from 'next/server';
import { parseMockState } from './mode';
import type { SearchParams } from './query';
import type { DataSource } from './source';
import { unavailableSource } from './unavailable';

export type { DataSource } from './source';

/**
 * The only entry point pages use for dashboard data (Server Components only).
 * Pass the page's searchParams so `?mock=empty|error|slow` can preview states in development.
 */
export async function getData(searchParams?: SearchParams): Promise<DataSource> {
  await connection(); // per-request data: never prerendered at build time
  // A literal NODE_ENV check (not a helper call) lets the bundler drop the mock module from
  // production builds entirely; scripts/assert-no-mock.mjs fails the build if it ever ships.
  if (process.env.NODE_ENV !== 'production') {
    const { createMockSource } = await import('./mock/index');
    return createMockSource(parseMockState(searchParams?.mock, process.env.NODE_ENV));
  }
  return unavailableSource;
}
