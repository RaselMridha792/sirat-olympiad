import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSource } from './index.ts';
import { LEAK_CANARY, withLeakCanaries } from './leak.ts';

test('canaries are added only where a field is absent', () => {
  const out = withLeakCanaries({ email: 'me@example.com', items: [{ name: 'A' }] });
  assert.equal(out.email, 'me@example.com');
  const item = out.items[0] as Record<string, unknown>;
  assert.equal(item.score, LEAK_CANARY.score);
  assert.equal(item.email, LEAK_CANARY.email);
  assert.equal(item.correctKey, LEAK_CANARY.text);
});

test('?mock=leak really feeds scores and emails into the student leaderboard data', async () => {
  // Proves the render check is meaningful: the page receives leaky rows and must still not show them.
  const view = await createMockSource('leak').leaderboard.get({ page: 1, pageSize: 20 });
  assert.equal(view.status, 'published');
  if (view.status !== 'published') return;
  const row = view.items[0] as unknown as Record<string, unknown>;
  assert.equal(row.score, LEAK_CANARY.score);
  assert.equal(row.email, LEAK_CANARY.email);
});

test('admin data is never altered by the leak mode', async () => {
  const page = await createMockSource('leak').admin.listUsers({ page: 1, pageSize: 5 });
  assert.ok(page.items.every((u) => !('score' in u)));
});
