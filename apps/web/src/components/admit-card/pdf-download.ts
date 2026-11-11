/**
 * The admit card PDF's fetch loop (core A2), apart from the browser so it can be tested: ask the API to make the
 * file (POST /admit-card/pdf), then fetch it (GET) until the worker has made it. "Not ready yet" is the only answer
 * that waits; anything else ends the loop with that error.
 */
export interface PdfDownloadDeps {
  /** POST /admit-card/pdf. */
  request: () => Promise<{ status: 'ready' | 'pending' }>;
  /** GET /admit-card/pdf: the file, or throws (404 pdf_not_ready while it is being made). */
  download: () => Promise<Blob>;
  wait: (ms: number) => Promise<void>;
}

/** The worker takes ~0.1 s a card; 30 tries 1.5 s apart cover a queue of a few hundred at a busy moment. */
export const PDF_POLL: PdfPoll = { tries: 30, intervalMs: 1_500 };

export interface PdfPoll {
  tries: number;
  intervalMs: number;
}

/** The file was not made in time: the job may still finish, so asking again soon usually works. */
export class PdfStillPending extends Error {
  constructor() {
    super('The PDF is still being made');
    this.name = 'PdfStillPending';
  }
}

/** True for the API's 404 pdf_not_ready (an ApiRequestError, read by shape so this file needs no browser code). */
export function isPdfNotReady(error: unknown): boolean {
  const e = error as { status?: unknown; body?: { details?: unknown } | null } | null;
  return (
    e?.status === 404 && Array.isArray(e.body?.details) && e.body.details.includes('pdf_not_ready')
  );
}

export async function fetchAdmitPdf(
  deps: PdfDownloadDeps,
  poll: PdfPoll = PDF_POLL,
): Promise<Blob> {
  const { status } = await deps.request();
  for (let attempt = 0; attempt < poll.tries; attempt += 1) {
    // A file that is ready is fetched at once; otherwise give the worker a moment first.
    if (attempt > 0 || status === 'pending') await deps.wait(poll.intervalMs);
    try {
      return await deps.download();
    } catch (error) {
      if (!isPdfNotReady(error)) throw error;
    }
  }
  throw new PdfStillPending();
}
