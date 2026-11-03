import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { aboutFacts } from '../../../content/about.ts';
import { homeFacts, safeExternalUrl } from '../../../content/home.ts';
import { aboutMessages } from '../../../i18n/messages/about.ts';
import { homeMessages } from '../../../i18n/messages/home.ts';
import {
  formatDay,
  participationModes,
  registrationWindow,
  visibleTeam,
  withHonorificText,
} from './home-view.ts';

test('roadmap days read in each language, in Dhaka time', () => {
  assert.equal(formatDay('bn', '2026-11-25'), '২৫ নভেম্বর, ২০২৬');
  assert.equal(formatDay('en', '2026-11-25'), '25 November 2026');
  assert.equal(formatDay('bn', '2027-03-19', '2027-03-20'), '১৯–২০ মার্চ, ২০২৭');
  // ICU puts thin spaces around the dash in English: compare the words, not the kind of space.
  assert.equal(
    formatDay('en', '2027-03-19', '2027-03-20').replace(/\s/g, ' '),
    '19 – 20 March 2027',
  );
  assert.deepEqual(registrationWindow(homeFacts.roadmap), { from: '2026-11-25', to: '2027-02-15' });
  assert.equal(registrationWindow([{ key: 'registrationOpens', from: '2026-11-25' }]), null);
});

test('offline participation and the team stay hidden until the client confirms them', () => {
  assert.equal(homeFacts.offline, false);
  assert.deepEqual(participationModes(homeFacts), ['online']);
  assert.deepEqual(participationModes({ offline: true }), ['online', 'offline']);
  assert.equal(aboutFacts.team.show, false);
  assert.deepEqual(visibleTeam(aboutFacts), []);
  const member = { name: 'A', role: 'B' };
  assert.deepEqual(
    visibleTeam({ team: { show: false, advisers: [member], convenors: [member] } }),
    [],
  );
  assert.deepEqual(visibleTeam({ team: { show: true, advisers: [member], convenors: [] } }), [
    'advisers',
  ]);
});

test('only https links leave the site, and the empty album link is hidden', () => {
  assert.equal(homeFacts.albumUrl, '');
  assert.equal(safeExternalUrl(homeFacts.albumUrl), null);
  for (const link of homeFacts.social) assert.equal(safeExternalUrl(link.url), link.url, link.key);
  assert.equal(
    safeExternalUrl(' https://drive.google.com/drive/folders/abc '),
    'https://drive.google.com/drive/folders/abc',
  );
  for (const bad of [
    'http://example.com',
    'javascript:alert(1)',
    'https://',
    'https://localhost',
    'https://exa mple.com',
    '//example.com',
    'data:text/html,x',
  ])
    assert.equal(safeExternalUrl(bad), null, bad);
});

/** Every string leaf with its dotted path. */
function leaves(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value === 'function' || value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, path ? `${path}.${key}` : key),
  );
}

test('the honorific token sits only where <WithHonorific> renders it, in both languages', () => {
  const rendered = /^(metaDescription|hero\.tagline|intro\.paragraphs\.\d+|goals\.(lead|closing))$/;
  for (const locale of ['en', 'bn'] as const) {
    const home = leaves(homeMessages[locale]);
    const placed = home.filter(([, text]) => text.includes('{saw}')).map(([path]) => path);
    assert.deepEqual(
      placed.filter((path) => !rendered.test(path)),
      [],
      locale,
    );
    assert.ok(placed.length >= 5, locale);
    assert.deepEqual(
      leaves(aboutMessages[locale]).filter(([, text]) => text.includes('{saw}')),
      [],
    );
    // The draft's honorific is the Arabic ligature; the fallback is one plain-text key away.
    assert.equal(homeMessages[locale].brand.honorific, 'ﷺ');
  }
  assert.equal(withHonorificText('রাসূলুল্লাহ {saw}-এর', '(সা.)'), 'রাসূলুল্লাহ (সা.)-এর');
});

test('the texts are plain text, and the components hard-code none', () => {
  for (const locale of ['en', 'bn'] as const) {
    for (const [path, text] of [
      ...leaves(homeMessages[locale]),
      ...leaves(aboutMessages[locale]),
    ]) {
      assert.doesNotMatch(text, /[<>]/, `${locale} ${path}`);
    }
  }
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith('.tsx'));
  assert.ok(files.length >= 3);
  for (const name of [...files.map((f) => new URL(f, dir)), new URL('../PublicShell.tsx', dir)]) {
    const source = readFileSync(name, 'utf8');
    // No Bangla and no honorific glyph in code: every word comes from i18n.
    assert.doesNotMatch(
      source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''),
      /[\u0980-\u09ff\ufdfa]/,
      name.pathname,
    );
    assert.doesNotMatch(source, /cookies\(|headers\(|dangerouslySetInnerHTML/, name.pathname);
  }
});
