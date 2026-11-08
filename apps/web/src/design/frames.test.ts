import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The page frames' accessibility and loading rules, checked in their sources (the a11y/perf pass, 2026-11-08).
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ui = (name: string) => read(`../../../../packages/ui/src/${name}`);
const count = (text: string, needle: string) => text.split(needle).length - 1;

test('every page frame starts with a skip link to its main#main (WCAG 2.4.1)', () => {
  const publicShell = read('../components/public/PublicShell.tsx');
  assert.equal(count(publicShell, '<SkipLink>'), 1, 'PublicShell');
  assert.equal(count(publicShell, 'id="main"'), 2, 'PublicShell: both main variants');

  const appShell = ui('components/AppShell.tsx');
  assert.match(appShell, /<SkipLink>\{skipLabel\}<\/SkipLink>/);
  assert.match(appShell, /<main id="main"/);
  assert.match(read('../components/NavShell.tsx'), /skipLabel=\{labels\?\.skip\}/);
  for (const layout of ['../app/(student)/dashboard/layout.tsx', '../app/admin/layout.tsx'])
    assert.match(read(layout), /skip: c\.nav\.skip/, layout);

  // The auth pages had no main landmark at all.
  assert.match(ui('components/AuthSplitLayout.tsx'), /<main id="main"/);
});

test('a language switch draws "বাংলা" in the system font, so English pages skip the Bangla web font', () => {
  assert.match(ui('styles/tokens.css'), /--font-system:/);
  assert.match(
    read('../components/LanguageSwitch.tsx'),
    /value === 'bn' && locale !== 'bn' && 'font-system'/,
  );
  assert.match(read('../components/public/PublicShell.tsx'), /other === 'bn' && 'font-system'/);
});
