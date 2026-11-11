import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAdmitPdf, isPdfNotReady, PdfStillPending } from './pdf-download.ts';

const notReady = Object.assign(new Error('not ready'), {
  status: 404,
  body: { details: ['pdf_not_ready'] },
});
const file = new Blob(['%PDF-'], { type: 'application/pdf' });

function deps(status: 'ready' | 'pending', answers: Array<Blob | Error>) {
  const waits: number[] = [];
  let downloads = 0;
  return {
    waits,
    downloads: () => downloads,
    deps: {
      request: async () => ({ status }),
      download: async () => {
        const next = answers[Math.min(downloads, answers.length - 1)];
        downloads += 1;
        if (next instanceof Error) throw next;
        return next as Blob;
      },
      wait: async (ms: number) => {
        waits.push(ms);
      },
    },
  };
}

test('a ready file is fetched at once, without waiting', async () => {
  const d = deps('ready', [file]);
  assert.equal(await fetchAdmitPdf(d.deps), file);
  assert.deepEqual(d.waits, []);
});

test('a pending file is fetched again after each "not ready" until it is there', async () => {
  const d = deps('pending', [notReady, notReady, file]);
  assert.equal(await fetchAdmitPdf(d.deps, { tries: 5, intervalMs: 10 }), file);
  assert.equal(d.downloads(), 3);
  assert.deepEqual(d.waits, [10, 10, 10]);
});

test('gives up after the last try with PdfStillPending', async () => {
  const d = deps('pending', [notReady]);
  await assert.rejects(fetchAdmitPdf(d.deps, { tries: 3, intervalMs: 1 }), PdfStillPending);
  assert.equal(d.downloads(), 3);
});

test('any other error ends the loop at once', async () => {
  const unavailable = Object.assign(new Error('503'), {
    status: 503,
    body: { details: ['pdf_unavailable'] },
  });
  const d = deps('pending', [unavailable, file]);
  await assert.rejects(fetchAdmitPdf(d.deps, { tries: 5, intervalMs: 1 }), unavailable);
  assert.equal(d.downloads(), 1);
});

test('only the 404 pdf_not_ready counts as "not ready"', () => {
  assert.equal(isPdfNotReady(notReady), true);
  assert.equal(isPdfNotReady({ status: 404, body: { details: ['not_registered'] } }), false);
  assert.equal(isPdfNotReady({ status: 503, body: { details: ['pdf_not_ready'] } }), false);
  assert.equal(isPdfNotReady(null), false);
  assert.equal(isPdfNotReady(new Error('x')), false);
});
