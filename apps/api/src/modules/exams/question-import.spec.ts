import { createHash } from 'node:crypto';
import { EXAM_LIMITS, QUESTION_IMPORT_LIMITS } from '@sirat/shared';
import { examDuplicates, readQuestionFile } from './question-import';

const HEADER = 'text,A,B,C,D,E,F,correct,explanation,keep_order';
const file = (...lines: string[]) => Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
const codes = (bytes: Buffer) =>
  readQuestionFile(bytes).errors.map((e) => `${e.row}:${e.field}:${e.code}`);

describe('readQuestionFile', () => {
  it('reads Bangla questions with quotes, commas and line breaks, BOM and CRLF', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      file(
        HEADER,
        '"বাংলাদেশের রাজধানী, কোনটি?",ঢাকা,চট্টগ্রাম,খুলনা,,,,a,"ঢাকা ""রাজধানী""\r\nদ্বিতীয় লাইন",TRUE',
        'Second question,Yes,No,,,,,B,,',
      ),
    ]);
    const read = readQuestionFile(bytes);
    expect(read.errors).toEqual([]);
    expect(read.rowCount).toBe(2);
    expect(read.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(read.rows).toEqual([
      {
        row: 2,
        question: {
          text: 'বাংলাদেশের রাজধানী, কোনটি?',
          options: [
            { key: 'A', text: 'ঢাকা' },
            { key: 'B', text: 'চট্টগ্রাম' },
            { key: 'C', text: 'খুলনা' },
          ],
          correctKey: 'A',
          explanation: 'ঢাকা "রাজধানী"\nদ্বিতীয় লাইন',
          keepOptionOrder: true,
        },
      },
      {
        row: 3,
        question: {
          text: 'Second question',
          options: [
            { key: 'A', text: 'Yes' },
            { key: 'B', text: 'No' },
          ],
          correctKey: 'B',
          explanation: null,
          keepOptionOrder: false,
        },
      },
    ]);
  });

  it('skips blank rows but keeps spreadsheet row numbers', () => {
    const read = readQuestionFile(file(HEADER, ',,,,,,,,,', 'Q,a,b,,,,,A,,', '', 'R,a,b,,,,,Z,,'));
    expect(read.rowCount).toBe(2);
    expect(read.errors).toEqual([{ row: 5, field: 'correct', code: 'correct_key_missing' }]);
  });

  it('refuses bytes that are not UTF-8 (a Windows-1252 export)', () => {
    expect(codes(Buffer.from([...Buffer.from(`${HEADER}\r\nCaf`), 0xe9, 0x0d, 0x0a]))).toEqual([
      '0:file:not_utf8',
    ]);
  });

  it('refuses a missing or wrong header, an empty file, and broken quoting', () => {
    expect(codes(Buffer.from(''))).toEqual(['0:file:empty']);
    expect(codes(file(HEADER))).toEqual(['0:file:empty']);
    expect(
      codes(file('question,A,B,C,D,E,F,correct,explanation,keep_order', 'Q,a,b,,,,,A,,')),
    ).toEqual(['1:row:header']);
    expect(codes(file('text,A,B,C,D,E,F,correct', 'Q,a,b,,,,,A'))).toEqual(['1:row:header']);
    expect(codes(file(HEADER, 'Q,a,b,,,,,A,,', 'R,"a,b,,,,,A,,'))).toEqual([
      '3:row:unterminated_quote',
    ]);
    expect(codes(file(HEADER, 'Q,a"x,b,,,,,A,,'))).toEqual(['2:row:bad_quote']);
  });

  it('accepts the header without regard to case or spaces', () => {
    const read = readQuestionFile(
      file(' Text ,a,b,c,d,e,f,CORRECT,Explanation,Keep_Order', 'Q,a,b,,,,,A,,'),
    );
    expect(read.errors).toEqual([]);
  });

  it(`refuses more than ${QUESTION_IMPORT_LIMITS.maxRows} data rows, and takes exactly that many`, () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => `Question ${i},a,b,,,,,A,,`);
    expect(codes(file(HEADER, ...rows(QUESTION_IMPORT_LIMITS.maxRows + 1)))).toEqual([
      '0:file:too_many_rows',
    ]);
    const read = readQuestionFile(file(HEADER, ...rows(QUESTION_IMPORT_LIMITS.maxRows)));
    expect(read.errors).toEqual([]);
    expect(read.rows).toHaveLength(QUESTION_IMPORT_LIMITS.maxRows);
  });

  it('names every problem of a row by its column', () => {
    expect(codes(file(HEADER, ',,b,,,x,,,,maybe'))).toEqual([
      '2:text:required',
      '2:A:required',
      '2:C:gap',
      '2:D:gap',
      '2:correct:required',
      '2:keep_order:invalid_boolean',
    ]);
    expect(codes(file(HEADER, 'Q,a,b,c,d,e,f,G,,'))).toEqual(['2:correct:correct_key_missing']);
    expect(codes(file(HEADER, 'Q,a,b,,,,,C,,'))).toEqual(['2:correct:correct_key_missing']);
    expect(codes(file(HEADER, 'Q,a,b,,,,,AB,,'))).toEqual(['2:correct:correct_key_missing']);
    expect(codes(file(HEADER, 'Q,a,b,,,,,A,'))).toEqual(['2:row:column_count']);
    expect(codes(file(HEADER, 'Q,a,b,,,,,A,,,'))).toEqual(['2:row:column_count']);
  });

  it('checks the sizes against EXAM_LIMITS, at and over each limit', () => {
    const t = 'ক'.repeat(EXAM_LIMITS.questionTextMax);
    const o = 'খ'.repeat(EXAM_LIMITS.optionTextMax);
    const x = 'গ'.repeat(EXAM_LIMITS.explanationMax);
    expect(codes(file(HEADER, `${t},${o},b,,,,,A,${x},`))).toEqual([]);
    expect(codes(file(HEADER, `${t}ক,${o}খ,b,,,,,A,${x}গ,`))).toEqual([
      '2:text:too_long',
      '2:A:too_long',
      '2:explanation:too_long',
    ]);
  });

  it('refuses control characters in any cell (Postgres refuses U+0000), but keeps tabs and line breaks', () => {
    const NUL = String.fromCharCode(0);
    const BEL = String.fromCharCode(7);
    const DEL = String.fromCharCode(0x7f);
    expect(
      codes(
        file(
          HEADER,
          `Q${NUL}one,a,b,,,,,A,,`,
          `Q two,a,b${BEL},,,,,A,,`,
          `Q three,a,b,,,,,A,why${DEL},`,
        ),
      ),
    ).toEqual([
      '2:text:control_character',
      '3:B:control_character',
      '4:explanation:control_character',
    ]);
    const tab = String.fromCharCode(9);
    const read = readQuestionFile(file(HEADER, `"Q${tab}four\nline two",a,b,,,,,A,,`));
    expect(read.errors).toEqual([]);
    expect(read.rows[0]?.question.text).toBe(`Q${tab}four\nline two`);
  });

  it('refuses a question twice in the file, by the publish rule (NFKC, spaces, case)', () => {
    expect(codes(file(HEADER, 'What is  CSV?,a,b,,,,,A,,', ' what is csv? ,a,b,,,,,A,,'))).toEqual([
      '3:text:duplicate_in_file',
    ]);
  });
});

describe('examDuplicates', () => {
  it('flags rows whose text an active question of the exam already has', () => {
    const { rows } = readQuestionFile(file(HEADER, 'Old one,a,b,,,,,A,,', 'New one,a,b,,,,,A,,'));
    expect(examDuplicates(rows, ['OLD  one', 'something else'])).toEqual([
      { row: 2, field: 'text', code: 'duplicate_in_exam' },
    ]);
  });
});
