import type { PageQuery, Paginated } from '@sirat/shared';

/** What the API does in SQL: one page of an already filtered, ordered list (page clamped to range). */
export function paginate<T>(items: readonly T[], query: PageQuery): Paginated<T> {
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize)), 50);
  const lastPage = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(query.page)), lastPage);
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: items.length,
  };
}

const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase();

/** Case-insensitive "contains" (works for Bangla text too). */
export function matches(value: string | null | undefined, q: string | undefined): boolean {
  if (!q) return true;
  return value ? normalize(value).includes(normalize(q)) : false;
}

export function emptyPage<T>(query: PageQuery): Paginated<T> {
  return { items: [], page: 1, pageSize: Math.min(Math.max(1, query.pageSize), 50), total: 0 };
}
