import type { Font, Glyph, Subset } from '@pdf-lib/fontkit';
import type { PDFFont } from 'pdf-lib';

/**
 * Drawing a glyph BY ID needs pdf-lib internals: its public API draws text by code point through fontkit's own
 * layout, which cannot shape Bangla. HarfBuzz gives glyph ids; this adds each one to the font's subset the way
 * pdf-lib's CustomFontSubsetEmbedder.encodeText does (pdf-lib 1.17.1). The shape is checked before every use and a
 * change fails loudly (PdfLibInternalsChanged), never as a wrong PDF; pdf-lib-glyphs.spec.ts pins the versions.
 */
export const PDF_LIB_VERSION = '1.17.1';

export class PdfLibInternalsChanged extends Error {
  constructor(what: string) {
    super(`pdf-lib internals changed (${what}): the glyph-by-id path is written for pdf-lib ${PDF_LIB_VERSION}`);
    this.name = 'PdfLibInternalsChanged';
  }
}

/** pdf-lib 1.17.1's CustomFontSubsetEmbedder: the fields used here (private in its types). */
export interface SubsetEmbedder {
  font: Font;
  subset: Subset;
  glyphs: Glyph[];
  glyphIdMap: Map<number, number>;
  glyphCache: { invalidate(): void };
}

const isFunction = (value: unknown): boolean => typeof value === 'function';

/** The subset embedder behind a font embedded with `{ subset: true }`, after checking its shape. */
export function subsetEmbedder(font: PDFFont): SubsetEmbedder {
  const embedder = (font as unknown as { embedder?: Partial<Record<keyof SubsetEmbedder, unknown>> }).embedder;
  if (!embedder || typeof embedder !== 'object') throw new PdfLibInternalsChanged('PDFFont.embedder');
  const fontkitFont = embedder.font as Partial<Record<'getGlyph' | 'hasGlyphForCodePoint', unknown>> | undefined;
  if (!fontkitFont || !isFunction(fontkitFont.getGlyph) || !isFunction(fontkitFont.hasGlyphForCodePoint))
    throw new PdfLibInternalsChanged('embedder.font');
  const subset = embedder.subset as { includeGlyph?: unknown } | undefined;
  if (!subset || !isFunction(subset.includeGlyph)) throw new PdfLibInternalsChanged('embedder.subset');
  if (!Array.isArray(embedder.glyphs)) throw new PdfLibInternalsChanged('embedder.glyphs');
  if (!(embedder.glyphIdMap instanceof Map)) throw new PdfLibInternalsChanged('embedder.glyphIdMap');
  const cache = embedder.glyphCache as { invalidate?: unknown } | undefined;
  if (!cache || !isFunction(cache.invalidate)) throw new PdfLibInternalsChanged('embedder.glyphCache');
  return embedder as unknown as SubsetEmbedder;
}

/**
 * The subset's id for the font's glyph `gid`, adding the glyph on first use. `codePoints` become the glyph's
 * ToUnicode entry (the first text it was drawn for). ToUnicode per glyph is lossy for Bangla, so every run also
 * carries its exact text as /ActualText (shaped-pdf.ts).
 */
export function subsetGlyphId(embedder: SubsetEmbedder, gid: number, codePoints: number[]): number {
  // Glyph 0 is .notdef (a character the font lacks): every subset starts with it, at id 0.
  if (gid === 0) return 0;
  const known = embedder.glyphIdMap.get(gid);
  if (known !== undefined) return known;
  const glyph = embedder.font.getGlyph(gid, codePoints);
  const id = embedder.subset.includeGlyph(glyph);
  if (!Number.isInteger(id) || id < 1) throw new PdfLibInternalsChanged('subset.includeGlyph');
  embedder.glyphs[id - 1] = glyph;
  embedder.glyphIdMap.set(gid, id);
  embedder.glyphCache.invalidate();
  return id;
}
