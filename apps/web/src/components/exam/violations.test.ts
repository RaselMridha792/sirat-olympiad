import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDevtoolsKey, LeaveTracker } from './violations.ts';
import { clearAllExams, readExam, writeExam, type KeyValueStore } from './exam-storage.ts';

const key = (
  k: string,
  mods: Partial<Record<'ctrl' | 'shift' | 'meta' | 'alt', boolean>> = {},
) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
});

test('developer-tools keys are caught: F12, Ctrl+Shift+I/J/C, Cmd+Opt+I/J/C', () => {
  assert.equal(isDevtoolsKey(key('F12')), true);
  for (const k of ['I', 'J', 'C', 'i']) {
    assert.equal(isDevtoolsKey(key(k, { ctrl: true, shift: true })), true, `Ctrl+Shift+${k}`);
  }
  for (const k of ['i', 'j', 'c']) {
    assert.equal(isDevtoolsKey(key(k, { meta: true, alt: true })), true, `Cmd+Opt+${k}`);
  }
});

test('ordinary keys are not violations', () => {
  for (const k of [
    key('c', { ctrl: true }), // copy
    key('I', { shift: true }),
    key('a'),
    key('F5'),
    key('j', { ctrl: true }),
    key('i', { meta: true }),
  ])
    assert.equal(isDevtoolsKey(k), false, JSON.stringify(k));
});

test('leaving counts once until the page has focus again; leaving again counts again', () => {
  const t = new LeaveTracker();
  assert.equal(t.signal('blur', true), 'leave');
  assert.equal(t.signal('hidden', true), null, 'blur and hidden of one switch count once');
  assert.equal(t.signal('focus', true), 'return');
  assert.equal(t.signal('visible', true), null);
  assert.equal(t.signal('hidden', true), 'leave');
});

test('reloading or closing the page is not a violation, and nothing counts outside the exam', () => {
  const closing = new LeaveTracker();
  closing.signal('unloading', true);
  assert.equal(closing.signal('blur', true), null);
  assert.equal(closing.signal('hidden', true), null);
  const before = new LeaveTracker();
  assert.equal(before.signal('blur', false), null);
});

test('the local copy is per attempt, survives a damaged entry and is cleared on logout', () => {
  const map = new Map<string, string>();
  const store: KeyValueStore = {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  writeExam(store, 'a1', {
    seq: 2,
    answers: [1, null],
    violationCount: 3,
    events: [],
    pending: null,
  });
  assert.equal(readExam(store, 'a1')?.violationCount, 3);
  store.setItem('sirat.exam.v1.broken', '{not json');
  assert.equal(readExam(store, 'broken'), null);
  store.setItem('other.key', 'kept');
  clearAllExams(store);
  assert.deepEqual([...map.keys()], ['other.key']);
});
