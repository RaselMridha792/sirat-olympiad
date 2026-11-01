import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MyRound } from '@sirat/shared';
import { videoWindow } from './round-window.ts';

const at = Date.parse('2026-11-20T06:00:00.000Z');
const mine = (
  entryStatus: MyRound['entryStatus'],
  opensAt: string | null,
  closesAt: string | null,
): MyRound => ({
  round: { id: 'r2', name: 'Video', type: 'video', sortOrder: 2, opensAt, closesAt },
  entryStatus,
  videoUrl: null,
  videoSubmittedAt: null,
});

test('open inside the window while the entry is pending or sent', () => {
  for (const status of ['pending', 'submitted'] as const)
    assert.equal(
      videoWindow(mine(status, '2026-11-20T00:00:00.000Z', '2026-11-21T00:00:00.000Z'), at),
      'open',
    );
});

test('not yet before the opening or without times; closed at the close or once judged', () => {
  assert.equal(
    videoWindow(mine('pending', '2026-11-20T07:00:00.000Z', '2026-11-21T00:00:00.000Z'), at),
    'notYet',
  );
  assert.equal(videoWindow(mine('pending', null, null), at), 'notYet');
  assert.equal(
    videoWindow(mine('submitted', '2026-11-19T00:00:00.000Z', '2026-11-20T06:00:00.000Z'), at),
    'closed',
  );
  assert.equal(
    videoWindow(mine('evaluated', '2026-11-20T00:00:00.000Z', '2026-11-21T00:00:00.000Z'), at),
    'closed',
  );
});
