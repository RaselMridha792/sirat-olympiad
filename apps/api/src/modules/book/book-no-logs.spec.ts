import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Addresses, recipient phones and notes are a minor's personal data (plan 16): they must never reach a log. The
 * request logger already keeps only the method, the path without its query, the status and the request id
 * (common/logging/pino-http.options.ts); this test keeps the book module from logging anything itself.
 */
describe('the book module logs nothing itself', () => {
  it('has no logger and no console call', () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
    expect(sources.length).toBeGreaterThan(3);
    for (const file of sources) {
      const code = readFileSync(join(dir, file), 'utf8');
      expect([file, /\bLogger\b|console\./.test(code)]).toEqual([file, false]);
    }
  });
});
