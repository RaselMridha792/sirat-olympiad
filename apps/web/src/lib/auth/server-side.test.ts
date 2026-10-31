import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forwardedFor } from './forwarded.ts';
import { MeCache } from './me-cache.ts';

/** What the API (Express, trust proxy 1) takes as the client: the last X-Forwarded-For entry. */
const apiSees = (xff: string | null, peer: string) =>
  xff ? (xff.split(',').at(-1) ?? '').trim() : peer;

test('behind nginx, exactly one value goes out: X-Real-IP, never the client-made X-Forwarded-For', () => {
  // nginx: X-Real-IP $remote_addr, X-Forwarded-For $proxy_add_x_forwarded_for (client value + real address).
  const incoming = { realIp: '203.0.113.7', xff: '6.6.6.6, 10.0.0.1, 203.0.113.7' };
  const out = forwardedFor(incoming.realIp, true);
  assert.equal(out, '203.0.113.7');
  assert.equal(out?.includes(','), false);
  assert.equal(apiSees(out, '172.18.0.4'), '203.0.113.7');
  assert.equal(forwardedFor('2001:db8::7', true), '2001:db8::7');
  assert.equal(forwardedFor(' 198.51.100.2 ', true), '198.51.100.2');
});

test('a forged or missing X-Real-IP forwards nothing (the API then counts the web container)', () => {
  for (const bad of ['6.6.6.6, 203.0.113.7', 'evil', '999.1.1.1', '', null, undefined]) {
    assert.equal(forwardedFor(bad, true), null, String(bad));
  }
});

test('without nginx (dev), X-Real-IP is client input and is not forwarded', () => {
  assert.equal(forwardedFor('203.0.113.7', false), null);
});

test('MeCache keeps answers for the TTL, by token, and never stores the token itself', () => {
  let now = 1_000;
  const cache = new MeCache<{ id: string }>(30_000, 10, () => now);
  const token = 'header.payload.signature';
  cache.set(token, { id: 'u1' });
  assert.deepEqual(cache.get(token), { id: 'u1' });
  assert.equal(cache.get('another.token.value'), undefined);
  assert.equal(
    JSON.stringify([
      ...(cache as unknown as { entries: Map<string, unknown> }).entries.keys(),
    ]).includes(token),
    false,
  );
  now += 29_999;
  assert.deepEqual(cache.get(token), { id: 'u1' });
  now += 1;
  assert.equal(cache.get(token), undefined);
  assert.equal(cache.size, 0);
});

test('MeCache is bounded: the oldest entry goes first', () => {
  const cache = new MeCache<number>(60_000, 3, () => 0);
  for (const [i, t] of ['a', 'b', 'c', 'd'].entries()) cache.set(t, i);
  assert.equal(cache.size, 3);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('d'), 3);
  cache.set('b', 10); // refreshed: now the newest
  cache.set('e', 4);
  assert.equal(cache.get('c'), undefined);
  assert.equal(cache.get('b'), 10);
});
