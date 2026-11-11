import { inflateSync } from 'node:zlib';

/**
 * Reads back what a PDF from ShapedPdf says, for the tests and the image self-check: every run's /ActualText (the
 * text a reader copies and searches). ShapedPdf wraps every run it draws in one, so these strings are ALL the text
 * on the pages. A small reader for our own files only: it inflates each stream and scans it.
 */
export function actualTexts(pdf: Uint8Array): string[] {
  const raw = Buffer.from(pdf).toString('latin1');
  const chunks = [raw];
  const streams = /stream\r?\n/g;
  for (let match = streams.exec(raw); match; match = streams.exec(raw)) {
    if (raw.slice(match.index - 3, match.index) === 'end') continue; // the "stream" in "endstream"
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    try {
      chunks.push(inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1'));
    } catch {
      /* not a Flate stream of text (an image, a font program): skipped */
    }
    streams.lastIndex = end + 'endstream'.length;
  }
  const texts: string[] = [];
  for (const chunk of chunks)
    for (const m of chunk.matchAll(/\/ActualText\s*<([0-9A-Fa-f\s]*)>/g)) texts.push(fromUtf16Hex(m[1] ?? ''));
  return texts;
}

/** pdf-lib's PDFHexString.fromText: UTF-16BE with a byte-order mark, as hex. */
function fromUtf16Hex(hex: string): string {
  const bytes = Buffer.from(hex.replace(/\s/g, ''), 'hex');
  const body = bytes[0] === 0xfe && bytes[1] === 0xff ? bytes.subarray(2) : bytes;
  let text = '';
  for (let i = 0; i + 1 < body.length; i += 2) text += String.fromCharCode(((body[i] as number) << 8) | (body[i + 1] as number));
  return text;
}
