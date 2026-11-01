import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAUNCH, type LaunchTable, isLive, liveIn } from './launch.ts';

/* The launch table (LAUNCH-PLAN §8, L1): one row per dashboard page, and "soon" only from the table. */

const APP = fileURLToPath(new URL('../app/', import.meta.url));
/** Read as the wider type: today every row is live, and the soon branches below must still compile. */
const TABLE: LaunchTable = LAUNCH;

/** Every page as its route ([segments] kept, route groups dropped), as scripts/check-pages.mjs finds them. */
function routes(dir: string, parts: string[] = []): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      out.push(...routes(path, /^\(.+\)$/.test(name) ? parts : [...parts, name]));
    else if (name === 'page.tsx') out.push('/' + parts.join('/'));
  }
  return out;
}
const pagesUnder = (prefix: string) =>
  routes(APP).filter((r) => r === prefix || r.startsWith(`${prefix}/`));
const PAGES = [...pagesUnder('/dashboard'), ...pagesUnder('/admin')].sort();

/** Where `route`'s page.tsx is (route groups searched). */
function pageFile(
  route: string,
  dir = APP,
  rest = route.split('/').filter(Boolean),
): string | null {
  if (rest.length === 0) {
    const file = join(dir, 'page.tsx');
    return statSync(file, { throwIfNoEntry: false })?.isFile() ? file : null;
  }
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    if (/^\(.+\)$/.test(name)) {
      const found = pageFile(route, path, rest);
      if (found) return found;
    } else if (name === rest[0]) {
      const found = pageFile(route, path, rest.slice(1));
      if (found) return found;
    }
  }
  return null;
}

/** A guarded page calls isLive('<route>' …) before its first data call (data.student/leaderboard/admin). */
function guardedBeforeData(source: string, route: string): boolean {
  const guard = source.indexOf(`isLive('${route}'`);
  const firstData = source.search(/\bdata\.(student|leaderboard|admin)\./);
  return guard >= 0 && (firstData < 0 || guard < firstData);
}

test('every /dashboard and /admin page has a row, and no row is orphaned', () => {
  assert.ok(PAGES.length > 10, 'the route walk found the pages');
  const rows = Object.keys(TABLE).sort();
  assert.deepEqual(
    PAGES.filter((p) => !rows.includes(p)),
    [],
    'add these pages to src/data/launch.ts',
  );
  assert.deepEqual(
    rows.filter((r) => !PAGES.includes(r)),
    [],
    'these rows have no page: remove them from src/data/launch.ts',
  );
});

test('production follows the table, whatever ?mock says', () => {
  for (const [route, state] of Object.entries(TABLE)) {
    for (const mock of [undefined, 'launch', 'empty'])
      assert.equal(
        isLive(route as keyof typeof LAUNCH, { kind: 'http' }, mock),
        state === 'live',
        route,
      );
  }
});

test('every soon page calls isLive before its first data call', () => {
  for (const [route, state] of Object.entries(TABLE)) {
    if (state !== 'soon') continue;
    const file = pageFile(route);
    assert.ok(file, `no page.tsx for ${route}`);
    assert.ok(
      guardedBeforeData(readFileSync(file, 'utf8'), route),
      `${route}: call isLive('${route}', data, params.mock) before the first data call`,
    );
  }
});

/* A fixture table proves the mechanism while every real page is live. */
const FIXTURE: LaunchTable = { '/dashboard': 'live', '/admin/fixture-soon': 'soon' };

test('a soon row is not live in production; a live row is', () => {
  assert.equal(liveIn(FIXTURE, '/admin/fixture-soon', { kind: 'http' }), false);
  assert.equal(liveIn(FIXTURE, '/dashboard', { kind: 'http' }), true);
  assert.equal(liveIn(FIXTURE, '/admin/no-row', { kind: 'http' }), false, 'no row: not live');
});

test("development's mock is live everywhere, and ?mock=launch previews the production view", () => {
  assert.equal(liveIn(FIXTURE, '/admin/fixture-soon', { kind: 'mock' }), true);
  assert.equal(liveIn(FIXTURE, '/admin/fixture-soon', { kind: 'mock' }, 'empty'), true);
  assert.equal(liveIn(FIXTURE, '/admin/fixture-soon', { kind: 'mock' }, 'launch'), false);
  assert.equal(liveIn(FIXTURE, '/admin/fixture-soon', { kind: 'mock' }, ['launch']), false);
  assert.equal(liveIn(FIXTURE, '/dashboard', { kind: 'mock' }, 'launch'), true);
});

test('the order check catches a missing guard and a guard after the data call', () => {
  const route = '/admin/fixture-soon';
  const good = `const user = await requireAccess('${route}');
    const data = await getData(params);
    if (!isLive('${route}', data, params.mock)) return <ComingSoonPage title={m.title} />;
    const rows = await data.admin.listThings();`;
  const late = `const data = await getData(params);
    const rows = await data.admin.listThings();
    if (!isLive('${route}', data, params.mock)) return <ComingSoonPage title={m.title} />;`;
  const missing = `const data = await getData(params);
    const rows = await data.admin.listThings();`;
  assert.equal(guardedBeforeData(good, route), true);
  assert.equal(guardedBeforeData(late, route), false);
  assert.equal(guardedBeforeData(missing, route), false);
});
