import * as fontkit from '@pdf-lib/fontkit';
import {
  beginText,
  endText,
  PDFDocument,
  type PDFFont,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
  type RGB,
  rgb,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  showText,
} from 'pdf-lib';
import { harfBuzz, type HarfBuzz, type HbFont, shape } from './harfbuzz';
import { fontBytes, PDF_FONT_KEYS, type PdfFontKey } from './pdf-assets';
import { subsetEmbedder, subsetGlyphId, type SubsetEmbedder } from './pdf-lib-glyphs';
import { type RunScript, splitRuns } from './text-runs';

/** A4 portrait, in points. */
export const A4 = { width: 595.28, height: 841.89 } as const;

export interface TextStyle {
  size: number;
  bold?: boolean;
  color?: RGB;
}

const BLACK = rgb(0, 0, 0);

/** An operand of a content-stream operator (pdf-lib's type leaves out dictionaries, which BDC needs). */
type OperatorArg = NonNullable<Parameters<typeof PDFOperator.of>[1]>[number];

/** HarfBuzz's side of each font: parsed once per process and kept (never freed while the process runs). */
const hbFonts = new Map<PdfFontKey, { font: HbFont; upem: number }>();

function hbFontFor(hb: HarfBuzz, key: PdfFontKey): { font: HbFont; upem: number } {
  let entry = hbFonts.get(key);
  if (!entry) {
    const bytes = fontBytes(key);
    const blob = hb.createBlob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const face = hb.createFace(blob, 0);
    entry = { font: hb.createFont(face), upem: face.upem };
    hbFonts.set(key, entry);
  }
  return entry;
}

interface Face {
  pdf: PDFFont;
  embedder: SubsetEmbedder;
  hb: HbFont;
  upem: number;
}

/**
 * A PDF with shaped text (core A2): HarfBuzz shapes each run, and its glyphs are drawn by id into a subset of the
 * Noto font, placed with HarfBuzz's advances and offsets, so Bangla looks as it does in a browser. Every run carries
 * its exact text as /ActualText, so copying, search and screen readers get the real text in readers that honour it
 * (Acrobat, PDFium/Chrome; pdf.js falls back to the per-glyph ToUnicode, which is lossy for Bangla: DECISIONS).
 * The web page stays the accessible, searchable version; a PDF from here is a print copy.
 * Output is deterministic: the same input gives the same bytes (no dates, pdf-lib's names come from a seeded RNG).
 * Shapes, lines and images use pdf-lib's own page API through `page`.
 */
export class ShapedPdf {
  private current?: PDFPage;
  private readonly fontKeys = new Map<PDFPage, Map<PdfFontKey, PDFName>>();

  private constructor(
    readonly doc: PDFDocument,
    private readonly hb: HarfBuzz,
    private readonly faces: Record<PdfFontKey, Face>,
  ) {}

  static async create(info: { title: string; language: 'bn' | 'en' }): Promise<ShapedPdf> {
    const hb = await harfBuzz();
    // No creation or modification date, no producer: the bytes depend on the content only.
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.registerFontkit(fontkit);
    doc.setTitle(info.title, { showInWindowTitleBar: true });
    doc.setLanguage(info.language === 'bn' ? 'bn-BD' : 'en-GB');
    const faces = {} as Record<PdfFontKey, Face>;
    for (const key of PDF_FONT_KEYS) {
      const pdf = await doc.embedFont(fontBytes(key), { subset: true });
      faces[key] = { pdf, embedder: subsetEmbedder(pdf), ...shapeFont(hb, key) };
    }
    return new ShapedPdf(doc, hb, faces);
  }

  /** Adds a page and draws on it from now on. */
  addPage(size: { width: number; height: number } = A4): PDFPage {
    this.current = this.doc.addPage([size.width, size.height]);
    return this.current;
  }

  get page(): PDFPage {
    if (!this.current) throw new Error('ShapedPdf: addPage first');
    return this.current;
  }

  /** The text's width in points, as text() would draw it. */
  measure(text: string, style: TextStyle): number {
    let width = 0;
    for (const run of this.runs(text)) {
      const face = this.face(run.script, style.bold);
      let units = 0;
      for (const glyph of shape(this.hb, face.hb, run.text)) units += glyph.advance;
      width += (units * style.size) / face.upem;
    }
    return width;
  }

  /** The largest size from `style.size` down to `minSize` (half-point steps) at which the text fits `maxWidth`. */
  fitSize(text: string, maxWidth: number, style: TextStyle, minSize: number): number {
    const width = this.measure(text, style);
    if (width <= maxWidth) return style.size;
    const size = Math.floor(((style.size * maxWidth) / width) * 2) / 2;
    return Math.max(minSize, size);
  }

  /** Greedy word wrap at spaces; a word wider than `maxWidth` gets a line of its own. */
  wrap(text: string, maxWidth: number, style: TextStyle): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && this.measure(candidate, style) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  }

  /** Draws `text` with its baseline at (x, y); returns its width in points. */
  text(text: string, x: number, y: number, style: TextStyle): number {
    const page = this.page;
    const ops: PDFOperator[] = [beginText(), setFillingColor(style.color ?? BLACK)];
    let pen = x;
    for (const run of this.runs(text)) {
      const key = faceKey(run.script, style.bold);
      const face = this.faces[key];
      const scale = style.size / face.upem;
      const glyphs = shape(this.hb, face.hb, run.text);
      ops.push(setFontAndSize(this.fontKey(page, key), style.size));
      // The run's exact text, for copying, search and screen readers (see the class comment).
      const span = this.doc.context.obj({ ActualText: PDFHexString.fromText(run.text) });
      ops.push(
        PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
          PDFName.of('Span'),
          span as unknown as OperatorArg,
        ]),
      );
      // A cluster's text (UTF-16 offsets into the run) is the ToUnicode entry of its first glyph.
      const starts = [...new Set(glyphs.map((g) => g.cluster))].sort((a, b) => a - b);
      const clusterText = (cluster: number): string =>
        run.text.slice(cluster, starts[starts.indexOf(cluster) + 1] ?? run.text.length);
      const seen = new Set<number>();
      for (const glyph of glyphs) {
        const first = !seen.has(glyph.cluster);
        seen.add(glyph.cluster);
        const codePoints = first ? [...clusterText(glyph.cluster)].map((c) => c.codePointAt(0) as number) : [];
        const id = subsetGlyphId(face.embedder, glyph.gid, codePoints);
        ops.push(setTextMatrix(1, 0, 0, 1, pen + glyph.dx * scale, y + glyph.dy * scale));
        ops.push(showText(PDFHexString.of(id.toString(16).padStart(4, '0'))));
        pen += glyph.advance * scale;
      }
      ops.push(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
    }
    ops.push(endText());
    page.pushOperators(...ops);
    return pen - x;
  }

  /** The finished file. */
  save(): Promise<Uint8Array> {
    return this.doc.save();
  }

  private runs(text: string) {
    const bengali = this.faces.bnRegular.embedder.font;
    return splitRuns(text, (cp) => bengali.hasGlyphForCodePoint(cp));
  }

  private face(script: RunScript, bold?: boolean): Face {
    return this.faces[faceKey(script, bold)];
  }

  /** The page's resource name for a font, added on first use on that page. */
  private fontKey(page: PDFPage, key: PdfFontKey): PDFName {
    let keys = this.fontKeys.get(page);
    if (!keys) {
      keys = new Map();
      this.fontKeys.set(page, keys);
    }
    let name = keys.get(key);
    if (!name) {
      const font = this.faces[key].pdf;
      name = page.node.newFontDictionary(font.name, font.ref);
      keys.set(key, name);
    }
    return name;
  }
}

const faceKey = (script: RunScript, bold?: boolean): PdfFontKey =>
  `${script === 'bn' ? 'bn' : 'lat'}${bold ? 'Bold' : 'Regular'}`;

function shapeFont(hb: HarfBuzz, key: PdfFontKey): { hb: HbFont; upem: number } {
  const { font, upem } = hbFontFor(hb, key);
  return { hb: font, upem };
}
