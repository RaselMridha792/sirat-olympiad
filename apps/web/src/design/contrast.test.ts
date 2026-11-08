import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TONES } from '../../../../packages/ui/src/tones.ts';

// WCAG 2.2 AA for normal-size text: 4.5:1. Token values come from the single tokens file, so a
// colour change that breaks readability fails here before it reaches a student's phone.
const AA = 4.5;
const uiSrc = fileURLToPath(new URL('../../../../packages/ui/src/', import.meta.url));
const webSrc = fileURLToPath(new URL('../', import.meta.url));

const TOKENS_CSS = readFileSync(join(uiSrc, 'styles/tokens.css'), 'utf8');
const COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  ...Object.fromEntries(
    [...TOKENS_CSS.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [
      m[1] as string,
      (m[2] as string).toLowerCase(),
    ]),
  ),
};
// Semantic tokens refer to the brand scales (`--color-primary: var(--color-green-600)`): resolve them, so a palette
// swap is an edit of the scales only and this test still checks the result.
for (const [, name, ref] of TOKENS_CSS.matchAll(
  /--color-([\w-]+):\s*var\(--color-([\w-]+)\)\s*;/g,
)) {
  const hex = COLORS[ref as string];
  assert.ok(hex, `--color-${name} refers to an unknown --color-${ref}`);
  COLORS[name as string] = hex;
}

function color(token: string): string {
  const hex = COLORS[token];
  assert.ok(hex, `unknown colour token "${token}"`);
  return hex;
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const ratio = (fg: string, bg: string) => contrast(color(fg), color(bg));

test('every badge/label tone reaches WCAG AA', () => {
  const failures: string[] = [];
  for (const [name, tone] of Object.entries(TONES)) {
    assert.equal(
      tone.className,
      `bg-${tone.bg} text-${tone.fg}`,
      `${name}: classes must match its tokens`,
    );
    const r = ratio(tone.fg, tone.bg);
    if (r < AA) failures.push(`${name}: text-${tone.fg} on bg-${tone.bg} = ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, []);
});

test('text tokens are readable on cards (surface) and on the page background', () => {
  const failures: string[] = [];
  const textTokens = [
    'ink',
    'ink-muted',
    'ink-faint',
    'secondary',
    'primary-strong',
    'accent-strong',
    'success-strong',
    'warning-strong',
    'danger-strong',
    'info-strong',
  ];
  for (const fg of textTokens) {
    for (const bg of ['surface', 'page']) {
      const r = ratio(fg, bg);
      if (r < AA) failures.push(`text-${fg} on bg-${bg} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, []);
});

test('the brand pairs reach AA: white on the greens, ink on gold, gold text, gold on the deep-green shell', () => {
  const pairs: Array<[fg: string, bg: string]> = [
    ['white', 'primary'],
    ['white', 'primary-strong'],
    ['white', 'primary-strong-hover'],
    ['white', 'secondary'],
    ['white', 'shell'],
    ['white', 'shell-soft'],
    ['ink', 'accent'],
    ['ink', 'accent-hover'],
    ['accent-strong', 'surface'],
    ['accent-strong', 'page'],
    ['accent-strong', 'accent-soft'],
    ['primary-strong', 'primary-soft'],
    ['secondary', 'secondary-soft'],
    // Kickers, dates and the active menu item on dark bands are gold, not green (green on the shell is 3.3:1).
    ['accent', 'shell'],
  ];
  const failures = pairs
    .map(([fg, bg]) => ({ fg, bg, r: ratio(fg, bg) }))
    .filter(({ r }) => r < AA)
    .map(({ fg, bg, r }) => `${fg} on ${bg} = ${r.toFixed(2)}:1`);
  assert.deepEqual(failures, []);
  // Gold icons and the large quote mark on the dark-green cards: non-text and large text need 3:1 (WCAG 1.4.11,
  // 1.4.3). Text on those cards stays white.
  assert.ok(ratio('accent', 'secondary') >= 3, 'accent icons on secondary');
  // The reason gold, not green, carries text on the shell.
  assert.ok(ratio('primary', 'shell') < AA);
});

// Every className string in the UI code that sets both a solid background and a text colour is
// checked as a pair (hover backgrounds too). Opacity variants (bg-white/10) are skipped: their
// backdrop is not knowable from the string alone.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

test('no low-contrast text/background pair in any className string', () => {
  const failures: string[] = [];
  for (const file of [...sourceFiles(uiSrc), ...sourceFiles(webSrc)]) {
    const source = readFileSync(file, 'utf8');
    for (const [literal] of source.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g)) {
      const classes = literal.slice(1, -1).split(/\s+/);
      const texts = classes
        .flatMap((c) => /^text-([\w-]+)$/.exec(c)?.[1] ?? [])
        .filter((t) => t in COLORS);
      const backgrounds = classes
        .flatMap((c) => /^(?:hover:)?bg-([\w-]+)$/.exec(c)?.[1] ?? [])
        .filter((b) => b in COLORS);
      for (const fg of texts) {
        for (const bg of backgrounds) {
          const r = ratio(fg, bg);
          if (r < AA) {
            failures.push(
              `${file.replace(/\\/g, '/').split('/src/').pop()}: text-${fg} on bg-${bg} = ${r.toFixed(2)}:1`,
            );
          }
        }
      }
    }
  }
  assert.deepEqual([...new Set(failures)], []);
});
