import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mockAllowed, parseMockState } from './mode.ts';

test('the mock switch is ignored in production builds', () => {
  assert.equal(mockAllowed('production'), false);
  for (const value of ['empty', 'error', 'slow']) {
    assert.equal(
      parseMockState(value, 'production'),
      null,
      `?mock=${value} must do nothing in production`,
    );
  }
});

test('the mock switch works in development and test', () => {
  assert.equal(parseMockState('empty', 'development'), 'empty');
  assert.equal(parseMockState(['error', 'slow'], 'development'), 'error');
  assert.equal(parseMockState('slow', 'test'), 'slow');
  assert.equal(parseMockState('drop-table', 'development'), null);
  assert.equal(parseMockState(undefined, 'development'), null);
});

test('getData gates the mock module behind a literal NODE_ENV check', () => {
  // The bundler can only drop the mock chunk from production builds if the condition is a literal
  // comparison; scripts/assert-no-mock.mjs then proves the built output has no mock code.
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /if \(process\.env\.NODE_ENV !== 'production'\) \{\s*const \{ createMockSource \} = await import\('\.\/mock\/index'\);/,
  );
  assert.match(source, /return unavailableSource;/);
});
