import { createHash } from 'node:crypto';

/*
 * Image uploads (RULEBOOK §15): the book cover (payments) and the certificate signatures (exam, C1). Restricted, not
 * scanned:
 * - the type comes from the file's magic bytes, never from its name or the browser's Content-Type, and must be one
 *   of the rule's types (SVG, GIF, HEIC and everything else are refused);
 * - the size and the pixel dimensions (read from the image header, never decoded) stay within the rule's caps, which
 *   also bounds what a later decode can inflate to (a decompression bomb); a header that cannot be read is refused;
 * - metadata is stripped before storing (an admin's phone photo can carry GPS): JPEG APP1 (EXIF/XMP), APP13 (IPTC)
 *   and comments; PNG text, eXIf and tIME chunks; WebP EXIF and XMP chunks (with the header's flags fixed). Bytes
 *   after the end of the image are dropped.
 * No image library: the containers are walked by hand, and pixel data is copied unchanged. Pure; unit-tested.
 */

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export type ImageProblem =
  'empty' | 'too_large' | 'unsupported_type' | 'unreadable' | 'bad_dimensions';

export class ImageRejected extends Error {
  constructor(readonly problem: ImageProblem) {
    super(`image refused: ${problem}`);
    this.name = 'ImageRejected';
  }
}

/** What an upload may be: its types, its size in bytes, and its sides in pixels. */
export interface ImageRules {
  types: readonly ImageType[];
  maxBytes: number;
  minSide: number;
  maxWidth: number;
  maxHeight: number;
}

export interface PreparedImage {
  data: Buffer;
  contentType: ImageType;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The type by magic bytes only. */
export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Checks, strips and fingerprints an upload against `rules`; throws ImageRejected with the reason. */
export function prepareImage(input: Buffer, rules: ImageRules): PreparedImage {
  if (input.length === 0) throw new ImageRejected('empty');
  if (input.length > rules.maxBytes) throw new ImageRejected('too_large');
  const contentType = sniffImageType(input);
  if (!contentType || !rules.types.includes(contentType))
    throw new ImageRejected('unsupported_type');
  const cleaned =
    contentType === 'image/jpeg'
      ? cleanJpeg(input)
      : contentType === 'image/png'
        ? cleanPng(input)
        : cleanWebp(input);
  const { width, height } = cleaned;
  if (
    width < rules.minSide ||
    height < rules.minSide ||
    width > rules.maxWidth ||
    height > rules.maxHeight
  )
    throw new ImageRejected('bad_dimensions');
  return {
    data: cleaned.data,
    contentType,
    width,
    height,
    byteSize: cleaned.data.length,
    sha256: createHash('sha256').update(cleaned.data).digest('hex'),
  };
}

interface Cleaned {
  data: Buffer;
  width: number;
  height: number;
}

const unreadable = () => new ImageRejected('unreadable');

// ───────────── JPEG ─────────────

/** Start-of-frame markers carry the size (C4 DHT, C8 JPG and CC DAC are not frames). */
const isStartOfFrame = (m: number) =>
  m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
/** APP1 (EXIF, XMP), APP13 (IPTC), COM. */
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);

function cleanJpeg(buf: Buffer): Cleaned {
  const out: Buffer[] = [buf.subarray(0, 2)]; // SOI
  let pos = 2;
  let width = 0;
  let height = 0;
  for (;;) {
    if (pos + 1 >= buf.length || buf[pos] !== 0xff) throw unreadable();
    let marker = buf[pos + 1] as number;
    while (marker === 0xff && pos + 2 < buf.length) {
      pos += 1; // fill bytes
      marker = buf[pos + 1] as number;
    }
    if (marker === 0xd9) throw unreadable(); // EOI before any scan: no image
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(buf.subarray(pos, pos + 2)); // markers without a length
      pos += 2;
      continue;
    }
    if (pos + 4 > buf.length) throw unreadable();
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2 || pos + 2 + length > buf.length) throw unreadable();
    if (isStartOfFrame(marker)) {
      if (length < 7) throw unreadable();
      height = buf.readUInt16BE(pos + 5);
      width = buf.readUInt16BE(pos + 7);
    }
    if (marker === 0xda) {
      // Start of scan: the entropy-coded data and any later scans run to the last EOI; anything after it is dropped.
      const end = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (end < pos) throw unreadable();
      out.push(buf.subarray(pos, end + 2));
      break;
    }
    if (!JPEG_DROP.has(marker)) out.push(buf.subarray(pos, pos + 2 + length));
    pos += 2 + length;
  }
  if (!width || !height) throw unreadable();
  return { data: Buffer.concat(out), width, height };
}

// ───────────── PNG ─────────────

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function cleanPng(buf: Buffer): Cleaned {
  const out: Buffer[] = [PNG_SIGNATURE];
  let pos = 8;
  let width = 0;
  let height = 0;
  let first = true;
  for (;;) {
    if (pos + 12 > buf.length) throw unreadable(); // no IEND
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + length;
    if (end > buf.length) throw unreadable();
    if (first) {
      if (type !== 'IHDR' || length !== 13) throw unreadable();
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
      first = false;
    }
    if (!PNG_DROP.has(type)) out.push(buf.subarray(pos, end)); // whole chunks: their CRCs stay valid
    pos = end;
    if (type === 'IEND') break; // anything after IEND is dropped
  }
  return { data: Buffer.concat(out), width, height };
}

// ───────────── WebP ─────────────

/** VP8X flags: EXIF (0x08) and XMP (0x04) are cleared with their chunks. */
const VP8X_METADATA_FLAGS = 0x08 | 0x04;

function cleanWebp(buf: Buffer): Cleaned {
  const riffEnd = 8 + buf.readUInt32LE(4);
  if (riffEnd > buf.length || riffEnd < 12 + 8) throw unreadable();
  const chunks: Buffer[] = [];
  let pos = 12;
  let width = 0;
  let height = 0;
  let canvas = false;
  while (pos + 8 <= riffEnd) {
    const fourcc = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const data = pos + 8;
    if (data + size > riffEnd) throw unreadable();
    const next = Math.min(data + size + (size & 1), riffEnd); // chunks are padded to an even size
    if (fourcc === 'VP8X') {
      if (size < 10) throw unreadable();
      const chunk = Buffer.from(buf.subarray(pos, next)); // a copy: its flags change
      chunk[8] = (chunk[8] as number) & ~VP8X_METADATA_FLAGS;
      width = 1 + buf.readUIntLE(data + 4, 3);
      height = 1 + buf.readUIntLE(data + 7, 3);
      canvas = true;
      chunks.push(chunk);
    } else if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
      if (!canvas && fourcc === 'VP8 ') {
        if (size < 10 || buf.readUIntBE(data + 3, 3) !== 0x9d012a) throw unreadable();
        width = buf.readUInt16LE(data + 6) & 0x3fff;
        height = buf.readUInt16LE(data + 8) & 0x3fff;
      } else if (!canvas && fourcc === 'VP8L') {
        if (size < 5 || buf[data] !== 0x2f) throw unreadable();
        const bits = buf.readUInt32LE(data + 1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      chunks.push(buf.subarray(pos, next));
    }
    pos = next;
  }
  if (!width || !height) throw unreadable();
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'latin1');
  return { data: Buffer.concat([header, body]), width, height }; // anything after the RIFF data is dropped
}
