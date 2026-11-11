'use client';
import { useState } from 'react';
import { FileDown } from 'lucide-react';
import type { AdmitCardPdfLocale, AdmitCardPdfStatus } from '@sirat/shared';
import { Button } from '@sirat/ui';
import { api, SessionExpiredError } from '@/lib/api';
import { fetchAdmitPdf, PdfStillPending } from './pdf-download';

export interface DownloadPdfLabels {
  button: string;
  preparing: string;
  done: string;
  hint: string;
  slow: string;
  failed: string;
}

/**
 * "Download PDF" (core A2): the API's worker makes the admit card as a PDF (the full ID with the keep-private line,
 * never the email), and the browser saves it. The file passes through api() (CSRF header, session renewal) and is
 * never kept beyond the download.
 */
export function DownloadAdmitPdf({
  locale,
  labels,
}: {
  locale: AdmitCardPdfLocale;
  labels: DownloadPdfLabels;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const file = await fetchAdmitPdf({
        request: () =>
          api<AdmitCardPdfStatus>('/admit-card/pdf', {
            method: 'POST',
            body: JSON.stringify({ locale }),
          }),
        download: () => api<Blob>(`/admit-card/pdf?locale=${locale}`, { as: 'blob' }),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'admit-card.pdf';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage({ text: labels.done, problem: false });
    } catch (error) {
      if (error instanceof SessionExpiredError) return; // api() is taking the browser to /login
      setMessage({
        text: error instanceof PdfStillPending ? labels.slow : labels.failed,
        problem: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button type="button" variant="outline" onClick={() => void download()} disabled={busy}>
        <FileDown aria-hidden="true" size={16} />
        {busy ? labels.preparing : labels.button}
      </Button>
      <p className="mt-2 text-xs text-ink-muted">{labels.hint}</p>
      <p
        role="status"
        aria-live="polite"
        className={
          message
            ? `mt-1 text-xs ${message.problem ? 'text-danger-strong' : 'text-ink-muted'}`
            : 'sr-only'
        }
      >
        {message?.text ?? ''}
      </p>
    </div>
  );
}
