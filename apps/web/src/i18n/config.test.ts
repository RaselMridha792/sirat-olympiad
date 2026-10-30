import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOCALE, intlTag, isLocale, negotiateLocale } from './config.ts';

test('isLocale accepts only supported locales', () => {
  assert.equal(isLocale('bn'), true);
  assert.equal(isLocale('en'), true);
  assert.equal(isLocale('fr'), false);
  assert.equal(isLocale(undefined), false);
  assert.equal(isLocale(''), false);
});

test('negotiateLocale picks the highest supported q-value', () => {
  assert.equal(negotiateLocale('bn-BD,bn;q=0.9,en-US;q=0.8,en;q=0.7'), 'bn');
  assert.equal(negotiateLocale('en-US,en;q=0.9,bn;q=0.8'), 'en');
  assert.equal(negotiateLocale('fr-FR,fr;q=0.9,bn;q=0.5'), 'bn');
  assert.equal(negotiateLocale('de;q=1, en;q=0.3, bn;q=0.6'), 'bn');
});

test('negotiateLocale falls back to the default', () => {
  assert.equal(negotiateLocale(null), DEFAULT_LOCALE);
  assert.equal(negotiateLocale(''), DEFAULT_LOCALE);
  assert.equal(negotiateLocale('fr,de;q=0.5'), DEFAULT_LOCALE);
  assert.equal(negotiateLocale('bn;q=0'), DEFAULT_LOCALE);
  assert.equal(negotiateLocale('bn;q=abc'), DEFAULT_LOCALE);
});

test('intlTag maps to Bangladesh-friendly tags', () => {
  assert.equal(intlTag('bn'), 'bn-BD');
  assert.equal(intlTag('en'), 'en-GB');
});
