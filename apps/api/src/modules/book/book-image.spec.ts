import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { COVER_MAX_BYTES, CoverRejected, prepareCover, sniffCoverType } from './book-image';

// ───────────── builders: small images made by hand ─────────────

const be16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
const be32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const le32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.from(type, 'latin1');
  return Buffer.concat([be32(data.length), head, data, be32(crc32(Buffer.concat([head, data])))]);
}

/** A real grayscale PNG (decodable), plus any extra chunks before IDAT. */
function png(
  width: number,
  height: number,
  extra: Buffer[] = [],
  trailer = Buffer.alloc(0),
): Buffer {
  const ihdr = Buffer.concat([be32(width), be32(height), Buffer.from([8, 0, 0, 0, 0])]);
  const rows = Buffer.alloc((width + 1) * height); // filter byte 0 + black pixels
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...extra,
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
    trailer,
  ]);
}

function pngChunks(buf: Buffer): { type: string; data: Buffer; crcOk: boolean }[] {
  const out = [];
  let pos = 8;
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    const crc = buf.readUInt32BE(pos + 8 + length);
    out.push({ type, data, crcOk: crc === crc32(buf.subarray(pos + 4, pos + 8 + length)) });
    pos += 12 + length;
  }
  return out;
}

const segment = (marker: number, payload: Buffer) =>
  Buffer.concat([Buffer.from([0xff, marker]), be16(payload.length + 2), payload]);

/** A baseline JPEG's container: JFIF, EXIF with GPS, a comment, tables, a frame, a scan, EOI, and a trailer. */
function jpeg(width: number, height: number, trailer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    segment(0xe1, Buffer.from('Exif\0\0GPSLatitude 23.8103 GPSLongitude 90.4125', 'latin1')),
    segment(0xed, Buffer.from('Photoshop 3.0\0IPTC by-line: someone', 'latin1')),
    segment(0xfe, Buffer.from('secret comment', 'latin1')),
    segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    segment(
      0xc0,
      Buffer.concat([Buffer.from([8]), be16(height), be16(width), Buffer.from([1, 1, 0x11, 0])]),
    ),
    segment(0xc4, Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 0), Buffer.from([0])])),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]), // entropy-coded data (a stuffed 0xFF)
    Buffer.from([0xff, 0xd9]),
    trailer,
  ]);
}

function riffChunk(fourcc: string, data: Buffer): Buffer {
  const pad = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from(fourcc, 'latin1'), le32(data.length), data, pad]);
}

/** An extended WebP: VP8X (EXIF and XMP flags set), a lossless image, EXIF and an odd-sized XMP chunk. */
function webp(width: number, height: number): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08 | 0x04 | 0x10; // EXIF, XMP, alpha
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const vp8l = Buffer.alloc(5 + 4);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  const body = Buffer.concat([
    riffChunk('VP8X', vp8x),
    riffChunk('VP8L', vp8l),
    riffChunk('EXIF', Buffer.from('Exif GPS 23.81 90.41', 'latin1')),
    riffChunk('XMP ', Buffer.from('<x:xmpmeta>gps</x:xmpmeta>!', 'latin1')),
  ]);
  return Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    le32(4 + body.length),
    Buffer.from('WEBP', 'latin1'),
    body,
  ]);
}

const problem = (buf: Buffer) => {
  try {
    prepareCover(buf);
    return 'accepted';
  } catch (e) {
    return e instanceof CoverRejected ? e.problem : 'threw something else';
  }
};

// ───────────── tests ─────────────

describe('the book cover (plan 16.5)', () => {
  it('knows JPEG, PNG and WebP by their magic bytes only', () => {
    expect(sniffCoverType(jpeg(300, 400))).toBe('image/jpeg');
    expect(sniffCoverType(png(300, 400))).toBe('image/png');
    expect(sniffCoverType(webp(300, 400))).toBe('image/webp');
    // prepareCover takes only the bytes: a file name or a browser Content-Type cannot change the answer.
    expect(prepareCover(png(300, 400)).contentType).toBe('image/png');
  });

  it('refuses SVG, GIF, HEIC, HTML and anything else', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(200)]);
    const heic = Buffer.concat([
      be32(24),
      Buffer.from('ftypheicmif1heic', 'latin1'),
      Buffer.alloc(200),
    ]);
    const html = Buffer.from('<!doctype html><script>alert(1)</script>');
    for (const bad of [svg, gif, heic, html]) expect(problem(bad)).toBe('unsupported_type');
    expect(problem(Buffer.alloc(0))).toBe('empty');
  });

  it('refuses more than 800 KB, and sides under 100 or over 4000 px', () => {
    expect(problem(Buffer.concat([png(300, 300), Buffer.alloc(COVER_MAX_BYTES)]))).toBe(
      'too_large',
    );
    expect(problem(png(99, 300))).toBe('bad_dimensions');
    expect(problem(png(300, 4001))).toBe('bad_dimensions');
    expect(problem(jpeg(4001, 300))).toBe('bad_dimensions');
    expect(problem(webp(100, 99))).toBe('bad_dimensions');
    expect(problem(png(100, 4000))).toBe('accepted');
  });

  it('refuses a broken container (no IEND, no frame, a chunk past the end)', () => {
    const full = png(300, 300);
    expect(problem(full.subarray(0, full.length - 12))).toBe('unreadable');
    const noFrame = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      segment(0xe0, Buffer.from('JFIF\0')),
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(problem(noFrame)).toBe('unreadable');
    const cut = webp(300, 300);
    expect(problem(cut.subarray(0, 30))).toBe('unreadable');
  });

  it('JPEG: drops EXIF (GPS), IPTC and comments, keeps the frame and the scan, and drops a trailer after EOI', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>', 'latin1');
    const cover = prepareCover(jpeg(640, 900, html));
    const text = cover.data.toString('latin1');
    expect(cover).toMatchObject({ contentType: 'image/jpeg', width: 640, height: 900 });
    for (const gone of ['Exif', 'GPSLatitude', 'IPTC', 'secret comment', '<html>'])
      expect(text).not.toContain(gone);
    expect(text).toContain('JFIF');
    expect(cover.data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(cover.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(cover.data.includes(Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]))).toBe(true);
    expect(cover.byteSize).toBe(cover.data.length);
    expect(cover.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('PNG: drops text, eXIf and tIME chunks; the rest is still a valid image', () => {
    const extra = [
      pngChunk('tEXt', Buffer.from('Comment\0taken at home, Mirpur', 'latin1')),
      pngChunk('eXIf', Buffer.from('MM\0*GPS', 'latin1')),
      pngChunk('tIME', Buffer.from([0x07, 0xea, 10, 31, 12, 0, 0])),
      pngChunk('pHYs', Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])),
    ];
    const cover = prepareCover(png(120, 160, extra, Buffer.from('trailing junk')));
    const chunks = pngChunks(cover.data);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    const idat = chunks.find((c) => c.type === 'IDAT')?.data ?? Buffer.alloc(0);
    expect(inflateSync(idat).length).toBe((120 + 1) * 160);
    expect(cover.data.toString('latin1')).not.toContain('Mirpur');
    expect(cover).toMatchObject({ width: 120, height: 160 });
  });

  it('WebP: drops EXIF and XMP, clears their flags and fixes the RIFF size', () => {
    const cover = prepareCover(webp(500, 700));
    const text = cover.data.toString('latin1');
    expect(text).not.toContain('Exif');
    expect(text).not.toContain('xmpmeta');
    expect(cover.data.readUInt32LE(4)).toBe(cover.data.length - 8);
    expect(cover.data.toString('latin1', 12, 16)).toBe('VP8X');
    expect((cover.data[20] as number) & 0x0c).toBe(0); // EXIF and XMP flags cleared
    expect((cover.data[20] as number) & 0x10).toBe(0x10); // alpha kept
    expect(cover).toMatchObject({ contentType: 'image/webp', width: 500, height: 700 });
  });
});
