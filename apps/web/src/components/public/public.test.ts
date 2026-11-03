import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_PAGES, publicPath } from '../../content/site.ts';
import { legalMessages } from '../../i18n/messages/legal.ts';
import { parseRegistrationInfo } from '../../lib/public-api.ts';

const SRC = new URL('../../', import.meta.url);
const MARKETING = new URL('../../app/(marketing)/', import.meta.url);

test('every public page exists in Bangla at the root and in English under /en', () => {
  const routes = PUBLIC_PAGES.flatMap((page) =>
    (['en', 'bn'] as const).map((locale) => ({ page, locale, path: publicPath(page, locale) })),
  );
  assert.deepEqual(
    routes.map((r) => r.path),
    [
      '/en',
      '/',
      '/en/about',
      '/about',
      '/en/privacy',
      '/privacy',
      '/en/terms',
      '/terms',
      '/en/refund-policy',
      '/refund-policy',
    ],
  );
  for (const { page, locale, path } of routes) {
    const file = new URL(`${path === '/' ? '' : path.slice(1) + '/'}page.tsx`, MARKETING);
    const source = readFileSync(file, 'utf8');
    // The route file only picks the page and the locale; the content is shared, so en and bn never drift.
    assert.ok(source.includes(`publicMetadata('${page}', '${locale}')`), path);
    assert.match(source, new RegExp(`locale="${locale}"`), path);
    // No cookie or header read: the page stays static.
    assert.doesNotMatch(source, /cookies\(|headers\(|connection\(/, path);
  }
});

test("the refund policy states the owner's rule in both languages", () => {
  assert.equal(
    legalMessages.en.refund.sections[0].paragraphs[0],
    'The registration fee is non-refundable.',
  );
  assert.equal(legalMessages.bn.refund.sections[0].paragraphs[0], 'রেজিস্ট্রেশন ফি ফেরতযোগ্য নয়।');
});

test('no page or component renders HTML from a string', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|jsx?)$/.test(name) && !name.endsWith('.test.ts')) {
        if (readFileSync(path, 'utf8').includes('dangerouslySetInnerHTML')) offenders.push(path);
      }
    }
  };
  walk(new URL('.', SRC).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  assert.deepEqual(offenders, []);
});

test('the registration info keeps only open and the fee, and refuses other shapes', () => {
  assert.deepEqual(
    parseRegistrationInfo({
      open: true,
      fee: { amountMinor: 40000, currency: 'BDT' },
      gradeLevels: [],
    }),
    { open: true, fee: { amountMinor: 40000, currency: 'BDT' } },
  );
  assert.deepEqual(parseRegistrationInfo({ open: false, fee: null }), { open: false, fee: null });
  for (const bad of [
    null,
    'x',
    {},
    { open: 'yes', fee: null },
    { open: true },
    { open: true, fee: { amountMinor: 0, currency: 'BDT' } },
    { open: true, fee: { amountMinor: 400.5, currency: 'BDT' } },
    { open: true, fee: { amountMinor: 40000 } },
  ])
    assert.equal(parseRegistrationInfo(bad), null, JSON.stringify(bad));
});
