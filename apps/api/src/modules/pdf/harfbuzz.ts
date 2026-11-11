/**
 * HarfBuzz (harfbuzzjs 0.10.3, WebAssembly): the text shaper, so Bangla conjuncts, vowel signs and reph come out as
 * a browser draws them. 0.10.3 is the last CommonJS release; 1.x is ESM-only with a top-level await, which this
 * CommonJS app and jest cannot load (DECISIONS, core A2). A bump re-runs the shaping-parity check (pdf.spec.ts).
 * The package ships no types: the part used here is typed below. Objects from it live in WebAssembly memory and are
 * freed by hand (destroy), never by the garbage collector.
 */
export interface HbBlob {
  destroy(): void;
}
export interface HbFace {
  /** Units per em: HarfBuzz's positions are in these units. */
  readonly upem: number;
  destroy(): void;
}
export interface HbFont {
  destroy(): void;
}
export interface HbGlyphInfo {
  /** After shaping: the font's glyph id (not a code point). */
  codepoint: number;
  /** The UTF-16 offset in the run of the text this glyph belongs to. */
  cluster: number;
}
export interface HbGlyphPosition {
  x_advance: number;
  y_advance: number;
  x_offset: number;
  y_offset: number;
}
export interface HbBuffer {
  addText(text: string): void;
  guessSegmentProperties(): void;
  getGlyphInfos(): HbGlyphInfo[];
  getGlyphPositions(): HbGlyphPosition[];
  destroy(): void;
}
export interface HarfBuzz {
  createBlob(data: ArrayBuffer): HbBlob;
  createFace(blob: HbBlob, index: number): HbFace;
  createFont(face: HbFace): HbFont;
  createBuffer(): HbBuffer;
  shape(font: HbFont, buffer: HbBuffer, features?: string): void;
  version_string(): string;
}

let loading: Promise<HarfBuzz> | undefined;

/** The HarfBuzz instance, loaded once per process; a failed load is tried again on the next call. */
export function harfBuzz(): Promise<HarfBuzz> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS without types; exports a promise of the API
  loading ??= (require('harfbuzzjs') as Promise<HarfBuzz>).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

/** One shaped glyph: the font's glyph id, its cluster, and its advance and offsets in font units. */
export interface ShapedGlyph {
  gid: number;
  cluster: number;
  advance: number;
  dx: number;
  dy: number;
}

/** Shapes `text` with `font` (script, language and direction guessed from the text) and frees the buffer. */
export function shape(hb: HarfBuzz, font: HbFont, text: string): ShapedGlyph[] {
  const buffer = hb.createBuffer();
  try {
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    if (positions.length !== infos.length) throw new Error('HarfBuzz returned positions that do not match glyphs');
    return infos.map((info, i) => {
      const position = positions[i] as HbGlyphPosition;
      return {
        gid: info.codepoint,
        cluster: info.cluster,
        advance: position.x_advance,
        dx: position.x_offset,
        dy: position.y_offset,
      };
    });
  } finally {
    buffer.destroy();
  }
}
