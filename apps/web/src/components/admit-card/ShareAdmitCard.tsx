'use client';
import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { Button } from '@sirat/ui';
import siratMark from '@/components/public/sirat-mark.png';

const SIZE = 1080;
const PAD = 90;

/** What the share image says. The ID is the server-masked form only: the full ID never reaches this component. */
export interface ShareCardText {
  siteName: string;
  heading: string;
  name: string;
  lines: string[];
  idLabel: string;
  idMasked: string;
}

/** A brand colour from the design tokens (no colour is written here: tokens.css is the one source). */
const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Breaks `text` into lines no wider than `width` at the canvas's current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws the share image (square, social-sized) on a canvas: the browser shapes the Bangla text itself. */
async function drawCard(text: ShareCardText): Promise<Blob> {
  const family = getComputedStyle(document.body).fontFamily;
  await document.fonts.load(`800 72px ${family}`, 'অআ');
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');

  ctx.fillStyle = token('--color-shell');
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = token('--color-shell-soft');
  ctx.beginPath();
  ctx.arc(SIZE - 60, 80, 260, 0, Math.PI * 2);
  ctx.fill();

  const mark = new Image();
  mark.src = siratMark.src;
  await mark.decode();
  ctx.fillStyle = token('--color-surface');
  ctx.beginPath();
  ctx.arc(PAD + 45, PAD + 45, 45, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(mark, PAD + 10, PAD + 10, 70, 70);

  const white = token('--color-surface');
  const accent = token('--color-accent');
  ctx.textBaseline = 'top';
  ctx.fillStyle = white;
  ctx.font = `700 38px ${family}`;
  ctx.fillText(text.siteName, PAD + 115, PAD + 25, SIZE - PAD * 2 - 115);

  let y = PAD + 200;
  ctx.fillStyle = accent;
  ctx.font = `800 64px ${family}`;
  ctx.fillText(text.heading, PAD, y, SIZE - PAD * 2);
  y += 110;

  ctx.fillStyle = white;
  ctx.font = `800 76px ${family}`;
  for (const line of wrap(ctx, text.name, SIZE - PAD * 2).slice(0, 2)) {
    ctx.fillText(line, PAD, y);
    y += 96;
  }
  y += 20;
  ctx.font = `500 40px ${family}`;
  for (const line of text.lines) {
    ctx.fillText(line, PAD, y, SIZE - PAD * 2);
    y += 60;
  }

  ctx.fillStyle = white;
  ctx.globalAlpha = 0.75;
  ctx.font = `600 34px ${family}`;
  ctx.fillText(text.idLabel, PAD, SIZE - PAD - 130);
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  ctx.font = `800 64px ui-monospace, monospace`;
  ctx.fillText(text.idMasked, PAD, SIZE - PAD - 80);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('blob'))), 'image/png'),
  );
}

/**
 * "Share" on the admit card: a PNG drawn in the browser with the masked ID only, shared through the device's share
 * sheet where it can take a file, otherwise downloaded. Nothing is uploaded.
 */
export function ShareAdmitCard({
  text,
  label,
  hint,
  failed,
}: {
  text: ShareCardText;
  label: string;
  hint: string;
  failed: string;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);

  async function share() {
    setBusy(true);
    setProblem(false);
    try {
      const blob = await drawCard(text);
      const file = new File([blob], 'sirat-admit-card.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: text.siteName });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (!(error instanceof DOMException && error.name === 'AbortError')) setProblem(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button type="button" variant="outline" onClick={() => void share()} disabled={busy}>
        <Share2 aria-hidden="true" size={16} />
        {label}
      </Button>
      <p className="mt-2 text-xs text-ink-muted">{hint}</p>
      <p
        role="status"
        aria-live="polite"
        className={problem ? 'mt-1 text-xs text-danger-strong' : 'sr-only'}
      >
        {problem ? failed : ''}
      </p>
    </div>
  );
}
