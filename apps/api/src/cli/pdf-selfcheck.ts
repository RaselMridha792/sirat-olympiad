/**
 * Proves this image can make the admit card PDF (core A2): the fonts are in assets/fonts, HarfBuzz's WebAssembly
 * loads, and pdf-lib's internals are the ones the renderer was written for. It renders a SAMPLE card in both
 * languages (made-up data, never a real student) and reads the text back.
 *
 *   CI:  docker run --rm --entrypoint node sirat-api dist/cli/pdf-selfcheck.js   (and sirat-worker)
 *   VPS: docker compose --env-file .env -f infra/docker-compose.yml run --rm --no-deps -T worker \
 *          node dist/cli/pdf-selfcheck.js
 *
 * Needs no settings and touches no database or Redis. Exit 0 with one line per language; 1 with the reason.
 */
import { formatParticipantId, type AdmitCard } from '@sirat/shared';
import { renderAdmitCardPdf } from '../modules/admit-card/admit-card-pdf';
import { harfBuzz } from '../modules/pdf/harfbuzz';
import { actualTexts } from '../modules/pdf/pdf-inspect';

/** A made-up card: a valid-looking ID that no registration has (the check digit is wrong on purpose). */
export const SAMPLE_CARD: AdmitCard = {
  participantId: 'ON00000000001',
  participantIdMasked: 'ON •••• •••• •01',
  mode: 'online',
  name: 'স্বনির্ভর পরীক্ষা Self Check',
  category: 'activist',
  gradeLevel: 'Class 8',
  fee: { amountMinor: 40000, currency: 'BDT', paidAt: '2026-11-10T09:30:00.000Z' },
  registeredAt: '2026-11-10T09:28:00.000Z',
  exam: {
    examId: '00000000-0000-0000-0000-000000000000',
    title: 'Self check exam',
    windowStart: '2026-11-28T04:00:00.000Z',
    windowEnd: '2026-11-28T06:00:00.000Z',
    durationMinutes: 30,
    roundName: 'Round 1',
  },
};

/** One line per language; throws with the reason when a file is wrong. */
export async function pdfSelfCheck(): Promise<string[]> {
  const hb = await harfBuzz();
  const lines: string[] = [];
  for (const locale of ['bn', 'en'] as const) {
    const started = Date.now();
    const pdf = await renderAdmitCardPdf(SAMPLE_CARD, locale);
    const texts = actualTexts(pdf);
    const text = texts.join('');
    if (Buffer.from(pdf.subarray(0, 5)).toString('latin1') !== '%PDF-')
      throw new Error(`${locale}: not a PDF`);
    if (!text.includes(formatParticipantId(SAMPLE_CARD.participantId)))
      throw new Error(`${locale}: the participant ID is missing from the text`);
    if (!text.includes(SAMPLE_CARD.name))
      throw new Error(`${locale}: the name is missing from the text`);
    lines.push(
      `pdf selfcheck ${locale}: ${Math.round(pdf.length / 1024)} KB, ${texts.length} text runs, ` +
        `${Date.now() - started} ms, HarfBuzz ${hb.version_string()}`,
    );
  }
  return lines;
}

if (require.main === module) {
  pdfSelfCheck().then(
    (lines) => {
      for (const line of lines) console.log(line);
      console.log('pdf selfcheck ok');
    },
    (error: unknown) => {
      console.error(
        `pdf selfcheck FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    },
  );
}
