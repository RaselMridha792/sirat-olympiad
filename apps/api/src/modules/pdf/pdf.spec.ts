import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName } from 'pdf-lib';
import { harfBuzz, type HarfBuzz, shape } from './harfbuzz';
import { ASSETS_DIR, fontBytes, PDF_FONT_FILES, PDF_FONT_KEYS } from './pdf-assets';
import { actualTexts } from './pdf-inspect';
import { PDF_LIB_VERSION, PdfLibInternalsChanged, subsetEmbedder } from './pdf-lib-glyphs';
import { ShapedPdf } from './shaped-pdf';
import { isBengaliCodePoint, splitRuns } from './text-runs';

const packageVersion = (name: string): string =>
  (JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')) as { version: string })
    .version;

/**
 * The spike's strings (core A2): conjuncts, reph, ya-phala, khanda ta, chandrabindu and mixed Bangla/Latin lines.
 * Shaped with each font, they gave identical glyph ids, clusters, advances and offsets on harfbuzzjs 0.10.3 and
 * 1.6.4 (140 of 140): the hashes below are that output. A bump of harfbuzzjs or a font must reproduce them, or is a
 * reviewed change of the printed output.
 */
const PARITY_STRINGS = [
  'মুহাম্মদ আব্দুল্লাহ',
  'তাসনিম জান্নাত',
  'সাক্কির আলম',
  'ঋতুপর্ণা সেনগুপ্ত',
  'অ্যাক্টিভিস্ট',
  'আমি অংশ নিচ্ছি!',
  'প্রবেশপত্র ও পরীক্ষার আইডি',
  'শ্রেণি ও ফি',
  'স্বাক্ষর',
  'ক্ষমা ও জ্ঞান',
  'রুদ্র হৃদয়',
  'ত্রিপুরা স্ত্রী',
  'যন্ত্র ভক্ত',
  'অঙ্ক কৃষ্ণ',
  'ব্রাহ্মণ',
  'বুদ্ধ শুদ্ধ',
  'কার্য সূর্য',
  'রেজিস্ট্রেশন সম্পন্ন',
  'শ্রীমঙ্গল',
  'ফাহিম মুনতাসির',
  'মাহমুদুল্লাহ রিয়াদ',
  'রাফসান জামান',
  'ইফতেখার উদ্দিন',
  'সৌম্য দ্যুতি',
  'উজ্জ্বল ঔজ্জ্বল্য',
  'আত্মবিশ্বাস',
  'চন্দ্রবিন্দু ঁ',
  'খৎনা ৎ',
  'য়',
  'ইন্টারন্যাশনাল সিরাত অলিম্পিয়াড ৩.০',
  'Fixture Student 1',
  'ON •••• •••• •52',
  'Class 5 / PYP 5 / Taisir',
  'ফি: ৳৪০০ (Paid)',
  'শনিবার, ১৪ নভেম্বর ২০২৬, ১০:০০ থেকে ১২:০০',
];
const PARITY_HASHES: Record<string, string> = {
  bnRegular: '64f810457dd5096741b3e8c6a6f2fd59bbbf05b8d83e251aadb5c5f02a8b7fc0',
  bnBold: '413298028c1dd6b6a87fe543e4df30a5c8d8403c99c317395472b0a51003a6af',
  latRegular: '5229c1c3f2b375e70c53db19c40842d575c6b8a1938341a855dc4a91e87b0647',
  latBold: '313518d29fa7868e3b3e60cfe722cfca8285656f37ad56c973a61faf5b6b496f',
};

/** The fonts as committed (assets/fonts/README.md): a replaced font changes the layout. */
const FONT_SHA256: Record<string, string> = {
  'NotoSansBengali-Regular.ttf': 'b55c62ee531e3214da6c0701daecea89a52ba42db7d8206b92e6b51f397a3193',
  'NotoSansBengali-Bold.ttf': '923c6a4c2eb618a57ed83f4bca855b4f5287b87906a4d9df40a2ffa8ebd8c2e8',
  'NotoSans-Regular.ttf': '478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823',
  'NotoSans-Bold.ttf': '1df075a380fc7cb898acf64c1f7b3b4dd780de3caa860178bf929de35817a913',
};

let hb: HarfBuzz;
beforeAll(async () => {
  hb = await harfBuzz();
});

describe('the pinned PDF stack (a version bump fails here first)', () => {
  it('runs pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1 and harfbuzzjs 0.10.3 (HarfBuzz 14.0.0)', () => {
    // pdf-lib-glyphs.ts reaches into pdf-lib's subset embedder: a new pdf-lib needs that code re-checked first.
    expect(packageVersion('pdf-lib')).toBe(PDF_LIB_VERSION);
    expect(packageVersion('@pdf-lib/fontkit')).toBe('1.1.1');
    expect(packageVersion('harfbuzzjs')).toBe('0.10.3');
    expect(hb.version_string()).toBe('14.0.0');
  });

  it('finds the subset embedder pdf-lib-glyphs.ts relies on, and refuses anything else loudly', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.registerFontkit(fontkit);
    const subset = await doc.embedFont(fontBytes('bnRegular'), { subset: true });
    expect(() => subsetEmbedder(subset)).not.toThrow();
    // A full (non-subset) embed has no subset: the path must refuse it, never draw with it.
    const full = await doc.embedFont(fontBytes('latRegular'));
    expect(() => subsetEmbedder(full)).toThrow(PdfLibInternalsChanged);
    expect(() => subsetEmbedder({} as never)).toThrow(PdfLibInternalsChanged);
    expect(() =>
      subsetEmbedder({ embedder: { ...subsetEmbedder(subset), glyphIdMap: {} } } as never),
    ).toThrow(/glyphIdMap/);
  });

  it('shapes the parity strings exactly as harfbuzzjs 1.6.4 did (the spike)', () => {
    for (const key of PDF_FONT_KEYS) {
      const bytes = fontBytes(key);
      const font = hb.createFont(
        hb.createFace(
          hb.createBlob(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
          ),
          0,
        ),
      );
      const all = PARITY_STRINGS.map((text) =>
        shape(hb, font, text).map((g) => [g.gid, g.cluster, g.advance, g.dx, g.dy]),
      );
      expect([key, createHash('sha256').update(JSON.stringify(all)).digest('hex')]).toEqual([
        key,
        PARITY_HASHES[key],
      ]);
    }
  });

  it('ships the committed fonts with their OFL licences', () => {
    for (const file of Object.values(PDF_FONT_FILES))
      expect([
        file,
        createHash('sha256')
          .update(readFileSync(join(ASSETS_DIR, 'fonts', file)))
          .digest('hex'),
      ]).toEqual([file, FONT_SHA256[file]]);
    for (const licence of ['OFL-NotoSansBengali.txt', 'OFL-NotoSans.txt'])
      expect(readFileSync(join(ASSETS_DIR, 'fonts', licence), 'utf8')).toContain(
        'SIL Open Font License, Version 1.1',
      );
  });
});

describe('splitRuns', () => {
  const bengaliHas = (cp: number) =>
    isBengaliCodePoint(cp) || '0123456789,.:;-()!?/ '.includes(String.fromCodePoint(cp));

  it('keeps Bangla with its punctuation and spaces in one run, and Latin in its own', () => {
    expect(splitRuns('ফি: ৳৪০০ (Paid)', bengaliHas)).toEqual([
      { script: 'bn', text: 'ফি: ৳৪০০ (' },
      { script: 'lat', text: 'Paid)' },
    ]);
    expect(splitRuns('ON 4821 0937 52', bengaliHas)).toEqual([
      { script: 'lat', text: 'ON 4821 0937 52' },
    ]);
    expect(splitRuns('Class 5 / শ্রেণি ৫', bengaliHas)).toEqual([
      { script: 'lat', text: 'Class 5 / ' },
      { script: 'bn', text: 'শ্রেণি ৫' },
    ]);
  });

  it('treats the joiners and the dandas as Bangla', () => {
    expect([0x200c, 0x200d, 0x0964, 0x0965, 0x0985, 0x09f3].every(isBengaliCodePoint)).toBe(true);
    expect([0x0041, 0x2022, 0x0963, 0x0a00].some(isBengaliCodePoint)).toBe(false);
  });
});

describe('ShapedPdf', () => {
  async function render(lines: string[]): Promise<{ bytes: Uint8Array; pdf: ShapedPdf }> {
    const pdf = await ShapedPdf.create({ title: 'Test', language: 'bn' });
    pdf.addPage();
    lines.forEach((line, i) => pdf.text(line, 40, 780 - i * 24, { size: 14, bold: i % 2 === 1 }));
    return { bytes: await pdf.save(), pdf };
  }

  it('carries every line as its exact text (/ActualText), run by run', async () => {
    const lines = [
      'প্রবেশপত্র ও পরীক্ষার আইডি',
      'ফি: ৳৪০০ (Paid)',
      'Fixture Student 1',
      'উজ্জ্বল ঔজ্জ্বল্য',
    ];
    const { bytes } = await render(lines);
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const texts = actualTexts(bytes);
    // Nothing drawn is missing or added; a line splits where a character is not in the Bengali font (the colon and
    // the bracket are Noto Sans's).
    expect(texts.join('')).toBe(lines.join(''));
    expect(texts).toEqual([
      'প্রবেশপত্র ও পরীক্ষার আইডি',
      'ফি',
      ': ',
      '৳৪০০ ',
      '(Paid)',
      'Fixture Student 1',
      'উজ্জ্বল ঔজ্জ্বল্য',
    ]);
  });

  it('draws the glyphs HarfBuzz chose (a conjunct is one glyph), not fontkit layout', async () => {
    const pdf = await ShapedPdf.create({ title: 'Test', language: 'bn' });
    pdf.addPage();
    pdf.text('ক্ষমা', 40, 780, { size: 14 });
    const shaped = shape(
      hb,
      (pdf as unknown as { faces: { bnRegular: { hb: never } } }).faces.bnRegular.hb,
      'ক্ষমা',
    );
    // ক ্ ষ ম া: 5 code points; ক্ষ is one conjunct glyph.
    expect(shaped.length).toBeLessThan(5);
    const embedder = subsetEmbedder(
      (pdf as unknown as { faces: { bnRegular: { pdf: never } } }).faces.bnRegular.pdf,
    );
    expect([...embedder.glyphIdMap.keys()].sort((a, b) => a - b)).toEqual(
      [...new Set(shaped.map((g) => g.gid))].sort((a, b) => a - b),
    );
  });

  it('gives the same bytes for the same content (a re-run overwrites with an identical file)', async () => {
    const lines = ['মুহাম্মদ আব্দুল্লাহ', 'ON 4821 0937 52'];
    const a = await render(lines);
    const b = await render(lines);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    const back = await PDFDocument.load(a.bytes, { updateMetadata: false });
    expect([back.getCreationDate(), back.getModificationDate(), back.getProducer()]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(back.getTitle()).toBe('Test');
    expect(String(back.catalog.get(PDFName.of('Lang')))).toBe('(bn-BD)');
  });

  it('measures what it draws, fits a long line and wraps at spaces', async () => {
    const pdf = await ShapedPdf.create({ title: 'Test', language: 'en' });
    pdf.addPage();
    const style = { size: 14 };
    const text = 'ইন্টারন্যাশনাল সিরাত অলিম্পিয়াড ৩.০ International Sirat Olympiad';
    const width = pdf.measure(text, style);
    expect(pdf.text(text, 40, 700, style)).toBeCloseTo(width, 6);
    // Half the width needs 7 pt: the minimum (8) wins.
    expect(pdf.fitSize(text, width / 2, style, 8)).toBe(8);
    expect(pdf.fitSize(text, width + 1, style, 8)).toBe(14);
    const half = pdf.fitSize(text, width * 0.75, style, 6);
    expect(pdf.measure(text, { size: half })).toBeLessThanOrEqual(width * 0.75);
    const lines = pdf.wrap(text, width / 2, style);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(text);
    for (const line of lines) expect(pdf.measure(line, style)).toBeLessThanOrEqual(width / 2);
  });
});
