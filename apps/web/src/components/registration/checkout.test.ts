import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkoutUrl } from './checkout.ts';

/* Which checkout URL the browser follows (06-API "Registration and payment": the answer's `gateway`). */

test("PayStation's checkout is followed over https only, in every build", () => {
  assert.equal(
    checkoutUrl('https://checkout.example/checkout/abc', 'paystation'),
    'https://checkout.example/checkout/abc',
  );
  assert.equal(checkoutUrl('http://checkout.example/checkout/abc', 'paystation'), null);
  assert.equal(checkoutUrl('http://127.0.0.1:18090/checkout/abc', 'paystation'), null);
});

test("the fake server's checkout may be http (the API says 'fake' only in fake mode)", () => {
  assert.equal(
    checkoutUrl('http://127.0.0.1:18090/checkout/abc', 'fake'),
    'http://127.0.0.1:18090/checkout/abc',
  );
  assert.equal(
    checkoutUrl('https://fake.test/checkout/abc', 'fake'),
    'https://fake.test/checkout/abc',
  );
});

test('never javascript:, data:, another scheme or a relative URL, whatever the gateway', () => {
  for (const gateway of ['paystation', 'fake']) {
    assert.equal(checkoutUrl('javascript:alert(1)', gateway), null);
    assert.equal(checkoutUrl('data:text/html,<p>x</p>', gateway), null);
    assert.equal(checkoutUrl('ftp://example.org/x', gateway), null);
    assert.equal(checkoutUrl('/checkout/abc', gateway), null);
    assert.equal(checkoutUrl('//evil.example/x', gateway), null);
    assert.equal(checkoutUrl('', gateway), null);
  }
});

test('an unknown gateway is refused; a missing one (an older API) counts as PayStation', () => {
  assert.equal(checkoutUrl('https://checkout.example/checkout/abc', 'other'), null);
  assert.equal(checkoutUrl('http://127.0.0.1:18090/checkout/abc', null), null);
  assert.equal(
    checkoutUrl('https://checkout.example/checkout/abc', undefined),
    'https://checkout.example/checkout/abc',
  );
  assert.equal(checkoutUrl('http://127.0.0.1:18090/checkout/abc', undefined), null);
});

test('every way to a checkout goes through the one helper', () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
  for (const file of ['./RegisterWizard.tsx', './PaymentResult.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /location\.(assign|replace|href)/, `${file} navigates by itself`);
    assert.doesNotMatch(source, /goToCheckout\([^)]*paymentUrl/, `${file} passes a bare URL`);
  }
  assert.match(
    read('./registration-api.ts'),
    /checkoutUrl\(checkout\.paymentUrl, checkout\.gateway\)/,
  );
});
