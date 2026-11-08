import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Colours live in ONE place, packages/ui/src/styles/tokens.css (owner, 2026-11-08: the client's brand colours,
// controlled globally). Everything else uses the semantic token utilities (bg-primary, text-accent-strong, …), so a
// brand change is a tokens.css change. This fails on any raw colour or default/brand palette class elsewhere.
const ROOTS = [
  fileURLToPath(new URL('../', import.meta.url)), // apps/web/src
  fileURLToPath(new URL('../../../../packages/ui/src/', import.meta.url)),
];
const TOKENS = 'styles/tokens.css';

/** A hex colour (#abc, #abcd, #aabbcc, #aabbccdd). */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/;
/** A CSS colour function. */
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/;
/** A Tailwind palette class: the defaults, and the brand scales, which only tokens.css may name. */
const PALETTE =
  /(?<![\w-])(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|shadow|divide|placeholder|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|gold)-(?:50|[1-9]00|950)(?![\w-])/;

function rawColour(line: string): string | null {
  for (const pattern of [HEX, FUNCTION, PALETTE]) {
    const match = pattern.exec(line);
    if (match) return match[0];
  }
  return null;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test('the patterns catch raw colours and leave tokens and anchors alone', () => {
  for (const bad of [
    "className='text-[#007a48]'",
    'color: #fff;',
    'fill="#aabbccdd"',
    'background: rgb(0 122 72);',
    'color: oklch(70% 0.1 150);',
    'className="bg-orange-500"',
    'className="hover:text-emerald-700/50"',
    'className="border-green-600"',
    'className="bg-gold-50"',
  ])
    assert.ok(rawColour(bad), bad);
  for (const good of [
    'className="bg-primary text-white"',
    'className="text-accent-strong bg-accent-soft"',
    'className="bg-white/10 text-black"',
    'href="#main"',
    'href="#faq"',
    'href={`#${id}`}',
    'className="text-rank-gold-strong bg-rank-gold-soft"',
    'fill="currentColor"',
  ])
    assert.equal(rawColour(good), null, good);
});

test('no raw colour or palette class outside tokens.css', () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of sources(root)) {
      if (file.replace(/\\/g, '/').endsWith(TOKENS)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const found = rawColour(line);
          if (found)
            offenders.push(
              `${file.replace(/\\/g, '/').split('/src/').pop()}:${index + 1} ${found}`,
            );
        });
    }
  }
  assert.deepEqual(offenders, []);
});
