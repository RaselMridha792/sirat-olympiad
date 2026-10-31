import { connection } from 'next/server';
import { createHttpSource } from './http/index';
import { pageApiGet } from './http/server';
import { parseMockState } from './mode';
import type { SearchParams } from './query';
import type { DataSource } from './source';

export type { DataSource } from './source';

/**
 * The only entry point pages use for dashboard data (Server Components only).
 * Pass the page's searchParams so `?mock=empty|error|slow` can preview states in development.
 * Production reads the API (data/http); development uses the mock unless `DATA_SOURCE=http`
 * (a local web against a local API).
 */
export async function getData(searchParams?: SearchParams): Promise<DataSource> {
  await connection(); // per-request data: never prerendered at build time
  // A literal NODE_ENV check (not a helper call) lets the bundler drop the mock module from
  // production builds entirely; scripts/assert-no-mock.mjs fails the build if it ever ships.
  if (process.env.NODE_ENV !== 'production') {
    const { createMockSource } = await import('./mock/index');
    if (process.env.DATA_SOURCE !== 'http')
      return createMockSource(parseMockState(searchParams?.mock, process.env.NODE_ENV));
  }
  return createHttpSource(pageApiGet);
}
