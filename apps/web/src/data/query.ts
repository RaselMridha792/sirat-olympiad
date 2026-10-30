import type { PageQuery } from '@sirat/shared';

/**
 * URL search-param parsing for server-paged lists. Everything from the URL is untrusted:
 * clamp numbers, cap lengths, and accept enum values only from an allow-list.
 */
export type SearchParams = Record<string, string | string[] | undefined>;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 100_000;
const MAX_SEARCH = 100;

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parsePage(value: string | string[] | undefined): number {
  const raw = first(value);
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const page = Number(raw);
  return page >= 1 && page <= MAX_PAGE ? page : 1;
}

export function parseSearch(value: string | string[] | undefined): string | undefined {
  const text = first(value)?.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH);
  return text ? text : undefined;
}

export function parseEnum<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const raw = first(value);
  return raw !== undefined && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/** Opaque ids (UUIDs in the API). Anything else is treated as absent. */
export function parseId(value: string | string[] | undefined): string | undefined {
  const raw = first(value);
  return raw && /^[A-Za-z0-9-]{1,64}$/.test(raw) ? raw : undefined;
}

export function clampPageSize(size: number): number {
  return Math.min(Math.max(1, Math.floor(size)), MAX_PAGE_SIZE);
}

export function parsePageQuery(params: SearchParams, pageSize = DEFAULT_PAGE_SIZE): PageQuery {
  const q = parseSearch(params.q);
  return { page: parsePage(params.page), pageSize: clampPageSize(pageSize), ...(q ? { q } : {}) };
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / clampPageSize(pageSize)));
}

/** Builds `path?a=b`, dropping empty values and page=1 so URLs stay canonical. */
export function hrefWith(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    if (key === 'page' && Number(value) === 1) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}
