import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BD_DISTRICTS } from '@sirat/shared';

/*
 * One source for the 64 districts: the registration form and the book order both use BD_DISTRICTS, and the database
 * CHECK (book_orders_district_check, migration *_book_checks) holds the same list. This test fails if they ever differ,
 * so a renamed district cannot be accepted by the form and refused by the database (or the reverse).
 */
const MIGRATIONS = join(__dirname, '../../../prisma/migrations');

function districtsInCheck(): string[] {
  const dir = readdirSync(MIGRATIONS).find((d) => d.endsWith('_book_checks'));
  if (!dir) throw new Error('the *_book_checks migration is missing');
  const sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
  const match = /"book_orders_district_check" CHECK \("district" IN \(([\s\S]*?)\)\)/.exec(sql);
  if (!match?.[1]) throw new Error('book_orders_district_check not found');
  return [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => (m[1] ?? '').replace(/''/g, "'"));
}

describe('districts (plan 16.1 B1, B8)', () => {
  it('are 64 unique names', () => {
    expect(BD_DISTRICTS).toHaveLength(64);
    expect(new Set(BD_DISTRICTS).size).toBe(64);
  });

  it('the database CHECK lists exactly the shared districts, in the same order', () => {
    expect(districtsInCheck()).toEqual([...BD_DISTRICTS]);
  });
});
