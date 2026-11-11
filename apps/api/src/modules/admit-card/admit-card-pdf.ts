import { type AdmitCard, type AdmitCardPdfLocale, formatParticipantId, SITE_NAME } from '@sirat/shared';
import { type RGB, rgb } from 'pdf-lib';
import { MARK_IMAGE, readAsset } from '../pdf/pdf-assets';
import { A4, ShapedPdf, type TextStyle } from '../pdf/shaped-pdf';
import { ADMIT_CARD_PDF_TEXTS } from './admit-card-pdf.texts';

const TIME_ZONE = 'Asia/Dhaka';

/** packages/ui/src/styles/tokens.css: primary (green-600/700/50), ink, ink-muted, line, warning-soft/-strong. */
const COLOR = {
  ink: hex('#0f172a'),
  muted: hex('#475569'),
  line: hex('#e2e8f0'),
  primary: hex('#007a48'),
  primaryStrong: hex('#00623b'),
  primarySoft: hex('#eaf6f0'),
  warningSoft: hex('#fef3c7'),
  warningStrong: hex('#92400e'),
};

const MARGIN = 48;
const WIDTH = A4.width - 2 * MARGIN;
const GAP = 20;
const COLUMN = (WIDTH - GAP) / 2;

interface Field {
  label: string;
  value: string;
  sub?: string;
}

/**
 * The admit card as an A4 PDF (core A2): the print copy of the admit card page, from the same AdmitCard data.
 * It carries the FULL participant ID with the keep-private line, and never the email (the lead, 2026-11-11). The web
 * page stays the up-to-date, accessible version; the PDF says so. Deterministic: the same card gives the same bytes.
 * A change here or in the texts bumps ADMIT_CARD_PDF_LAYOUT (admit-card-pdf-queue.ts).
 */
export async function renderAdmitCardPdf(card: AdmitCard, locale: AdmitCardPdfLocale): Promise<Uint8Array> {
  const t = ADMIT_CARD_PDF_TEXTS[locale];
  const tag = locale === 'bn' ? 'bn-BD' : 'en-GB';
  const format = (iso: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, ...options }).format(new Date(iso));
  const day = (iso: string) => format(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const date = (iso: string) => format(iso, { day: 'numeric', month: 'long', year: 'numeric' });
  const time = (iso: string) => format(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const amount = new Intl.NumberFormat(tag).format(card.fee.amountMinor / 100);
  const money = card.fee.currency === 'BDT' ? `৳${amount}` : `${card.fee.currency} ${amount}`;

  const pdf = await ShapedPdf.create({ title: `${t.title} | ${SITE_NAME[locale]}`, language: locale });
  const page = pdf.addPage();
  /** Positions are measured from the top edge here; pdf-lib's y runs up from the bottom. */
  const top = (y: number) => A4.height - y;

  // Header: the mark, the programme's name, the title, and the exam mode as a badge.
  const mark = await pdf.doc.embedPng(readAsset('images', MARK_IMAGE));
  page.drawImage(mark, { x: MARGIN, y: top(MARGIN + 54), width: 54, height: 54 });
  const badge: TextStyle = { size: 11, bold: true, color: COLOR.warningStrong };
  const badgeText = t.mode[card.mode];
  const badgeWidth = pdf.measure(badgeText, badge) + 24;
  page.drawRectangle({
    x: MARGIN + WIDTH - badgeWidth,
    y: top(MARGIN + 26),
    width: badgeWidth,
    height: 24,
    color: COLOR.warningSoft,
  });
  pdf.text(badgeText, MARGIN + WIDTH - badgeWidth + 12, top(MARGIN + 17.5), badge);
  const nameX = MARGIN + 68;
  const nameWidth = WIDTH - 68 - badgeWidth - 12;
  const siteStyle: TextStyle = { size: 12, bold: true, color: COLOR.primaryStrong };
  const site = SITE_NAME[locale];
  pdf.text(site, nameX, top(MARGIN + 18), { ...siteStyle, size: pdf.fitSize(site, nameWidth, siteStyle, 8) });
  pdf.text(t.title, nameX, top(MARGIN + 46), { size: 22, bold: true, color: COLOR.ink });

  let y = MARGIN + 72;
  page.drawLine({ start: { x: MARGIN, y: top(y) }, end: { x: MARGIN + WIDTH, y: top(y) }, thickness: 1, color: COLOR.line });
  y += 18;

  // The participant ID, in full, with the keep-private line.
  const keepStyle: TextStyle = { size: 10, color: COLOR.warningStrong };
  const keepLines = pdf.wrap(t.keepPrivate, WIDTH - 32, keepStyle);
  const idBox = 30 + 36 + keepLines.length * 15 + 14;
  page.drawRectangle({
    x: MARGIN,
    y: top(y + idBox),
    width: WIDTH,
    height: idBox,
    color: COLOR.primarySoft,
    borderColor: COLOR.primary,
    borderWidth: 1,
  });
  pdf.text(t.idLabel, MARGIN + 16, top(y + 24), { size: 10, bold: true, color: COLOR.muted });
  pdf.text(formatParticipantId(card.participantId), MARGIN + 16, top(y + 58), {
    size: 28,
    bold: true,
    color: COLOR.primaryStrong,
  });
  let line = y + 80;
  for (const text of keepLines) {
    pdf.text(text, MARGIN + 16, top(line), keepStyle);
    line += 15;
  }
  y += idBox + 24;

  // The candidate's details, two to a row.
  const exam = card.exam;
  const fields: Field[] = [
    { label: t.fields.name, value: card.name },
    { label: t.fields.category, value: card.category ? t.categories[card.category] : t.notProvided },
    { label: t.fields.gradeLevel, value: card.gradeLevel ?? t.notProvided },
    { label: t.fields.fee, value: money, sub: card.fee.paidAt ? t.paidOn(date(card.fee.paidAt)) : undefined },
    ...(exam
      ? [
          { label: t.fields.exam, value: exam.title, sub: exam.roundName ?? undefined },
          {
            label: t.fields.examTime,
            value: day(exam.windowStart),
            sub: t.examTime(time(exam.windowStart), time(exam.windowEnd)),
          },
        ]
      : [{ label: t.fields.examTime, value: t.examSoon }]),
    { label: t.fields.registeredAt, value: date(card.registeredAt) },
    { label: t.fields.mode, value: t.mode[card.mode] },
  ];
  const labelStyle: TextStyle = { size: 9.5, color: COLOR.muted };
  const valueStyle: TextStyle = { size: 13, bold: true, color: COLOR.ink };
  const subStyle: TextStyle = { size: 10, color: COLOR.muted };
  for (let i = 0; i < fields.length; i += 2) {
    const row = fields.slice(i, i + 2).map((field) => ({
      field,
      // A long name wraps (at most 3 lines, then it shrinks to fit them).
      lines: wrapFitted(pdf, field.value, COLUMN, valueStyle, 3),
    }));
    let rowHeight = 0;
    row.forEach(({ field, lines }, column) => {
      const x = MARGIN + column * (COLUMN + GAP);
      let at = y + 10;
      pdf.text(field.label, x, top(at), labelStyle);
      at += 6;
      for (const text of lines.texts) {
        at += lines.size + 4;
        pdf.text(text, x, top(at), { ...valueStyle, size: lines.size });
      }
      if (field.sub) {
        at += 15;
        pdf.text(field.sub, x, top(at), { ...subStyle, size: pdf.fitSize(field.sub, COLUMN, subStyle, 7) });
      }
      rowHeight = Math.max(rowHeight, at - y);
    });
    y += rowHeight + 18;
  }

  // Instructions, and the note that this is a print copy.
  const noteStyle: TextStyle = { size: 10.5, color: COLOR.ink };
  const notes = [t.instructions[card.mode], t.printCopy].map((text) => pdf.wrap(text, WIDTH - 44, noteStyle));
  const notesHeight = 34 + notes.reduce((sum, lines) => sum + lines.length * 15 + 4, 0) + 8;
  y += 4;
  page.drawRectangle({
    x: MARGIN,
    y: top(y + notesHeight),
    width: WIDTH,
    height: notesHeight,
    borderColor: COLOR.line,
    borderWidth: 1,
  });
  pdf.text(t.instructionsTitle, MARGIN + 16, top(y + 22), { size: 12, bold: true, color: COLOR.ink });
  let noteY = y + 42;
  for (const lines of notes) {
    pdf.text('•', MARGIN + 16, top(noteY), noteStyle);
    for (const text of lines) {
      pdf.text(text, MARGIN + 28, top(noteY), noteStyle);
      noteY += 15;
    }
    noteY += 4;
  }

  // Footer: the programme's name.
  const footerY = A4.height - MARGIN + 14;
  page.drawLine({
    start: { x: MARGIN, y: top(footerY - 14) },
    end: { x: MARGIN + WIDTH, y: top(footerY - 14) },
    thickness: 0.5,
    color: COLOR.line,
  });
  pdf.text(site, MARGIN, top(footerY), { size: 9, color: COLOR.muted });

  return pdf.save();
}

/**
 * Wraps to at most `maxLines` lines, shrinking the size until it fits them; at 8 pt it keeps every line it needs
 * (nothing of a name is ever cut).
 */
function wrapFitted(
  pdf: ShapedPdf,
  text: string,
  width: number,
  style: TextStyle,
  maxLines: number,
): { texts: string[]; size: number } {
  for (let size = style.size; size >= 8; size -= 0.5) {
    const texts = pdf.wrap(text, width, { ...style, size });
    if (texts.length <= maxLines && texts.every((t) => pdf.measure(t, { ...style, size }) <= width))
      return { texts, size };
  }
  const size = 8;
  return { texts: pdf.wrap(text, width, { ...style, size }), size };
}

function hex(value: string): RGB {
  const n = Number.parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
