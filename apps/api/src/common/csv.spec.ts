import { CSV_BOM, csvCell, csvRow, dhakaDateTime } from './csv';

describe('csv', () => {
  it('leaves plain text, numbers and Bangla as they are', () => {
    expect(csvCell('Rahim Uddin')).toBe('Rahim Uddin');
    expect(csvCell(400)).toBe('400');
    expect(csvCell('রহিম উদ্দিন')).toBe('রহিম উদ্দিন');
    expect(csvCell('01712345678')).toBe('01712345678');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(false)).toBe('false');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Dhaka, Mirpur')).toBe('"Dhaka, Mirpur"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('cr\rhere')).toBe('"cr\rhere"');
  });

  it('turns anything Excel would run as a formula into text', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('+8801712345678')).toBe("'+8801712345678");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    expect(csvCell('\rcmd')).toBe(`"'\rcmd"`);
    expect(csvCell('a=b')).toBe('a=b');
  });

  it('ends every row with CRLF', () => {
    expect(csvRow(['a', 1, null, 'b,c'])).toBe('a,1,,"b,c"\r\n');
  });

  it('has the UTF-8 byte order mark Excel needs for Bangla', () => {
    expect(CSV_BOM).toBe('﻿');
    expect(Buffer.from(CSV_BOM, 'utf8')).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('writes times in Asia/Dhaka (UTC+6, no daylight saving)', () => {
    expect(dhakaDateTime(new Date('2026-11-01T18:30:00Z'))).toBe('2026-11-02 00:30');
    expect(dhakaDateTime(new Date('2026-11-15T04:05:00Z'))).toBe('2026-11-15 10:05');
    expect(dhakaDateTime(null)).toBe('');
  });
});
