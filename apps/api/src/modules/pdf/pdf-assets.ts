import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * apps/api/assets in the repo, /app/assets in the api and worker images (`pnpm deploy` copies the package with its
 * assets; CI's image check renders a PDF inside both images). Fonts and their OFL licences: assets/fonts/README.md.
 */
export const ASSETS_DIR = join(__dirname, '..', '..', '..', 'assets');

/** The four faces the renderer embeds: Bengali text in Noto Sans Bengali, everything else in Noto Sans. */
export const PDF_FONT_FILES = {
  bnRegular: 'NotoSansBengali-Regular.ttf',
  bnBold: 'NotoSansBengali-Bold.ttf',
  latRegular: 'NotoSans-Regular.ttf',
  latBold: 'NotoSans-Bold.ttf',
} as const;
export type PdfFontKey = keyof typeof PDF_FONT_FILES;
export const PDF_FONT_KEYS = Object.keys(PDF_FONT_FILES) as PdfFontKey[];

/** The programme's mark (the web's sirat-mark.png), 512 × 512 PNG. */
export const MARK_IMAGE = 'sirat-mark.png';

const cache = new Map<string, Uint8Array>();

/** A file under assets/, read once per process (the files never change while it runs). */
export function readAsset(folder: 'fonts' | 'images', file: string): Uint8Array {
  const path = join(ASSETS_DIR, folder, file);
  let bytes = cache.get(path);
  if (!bytes) {
    bytes = new Uint8Array(readFileSync(path));
    cache.set(path, bytes);
  }
  return bytes;
}

export const fontBytes = (key: PdfFontKey): Uint8Array => readAsset('fonts', PDF_FONT_FILES[key]);
