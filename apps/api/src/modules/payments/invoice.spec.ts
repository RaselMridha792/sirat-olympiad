import { dhakaDateStamp, newInvoiceNumber } from './invoice';

const INVOICE_CHECK = /^[A-Z0-9]{10,20}$/; // payments_invoice_number_check

describe('invoice numbers', () => {
  it('is prefix + Dhaka date + 10 Crockford base32 characters, within the DB check', () => {
    const now = new Date('2026-11-04T10:00:00Z');
    for (const prefix of ['T', 'S', 'S2', 'ABC']) {
      const invoice = newInvoiceNumber(prefix, now);
      expect(invoice).toMatch(new RegExp(`^${prefix}261104[0-9A-HJKMNP-TV-Z]{10}$`));
      expect(invoice).toMatch(INVOICE_CHECK);
      expect(invoice.length).toBeLessThanOrEqual(20);
    }
  });

  it('uses the Dhaka date (UTC+6), not the UTC date', () => {
    expect(dhakaDateStamp(new Date('2026-11-04T17:59:59Z'))).toBe('261104');
    expect(dhakaDateStamp(new Date('2026-11-04T18:00:00Z'))).toBe('261105');
    expect(dhakaDateStamp(new Date('2026-12-31T18:30:00Z'))).toBe('270101');
  });

  it('never uses I, L, O or U, and maps every byte value', () => {
    const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    let seen = '';
    for (let i = 0; i < 256; i += 10) {
      seen += newInvoiceNumber('T', new Date(), () => all.subarray(i, i + 10)).slice(7);
    }
    expect(seen).not.toMatch(/[ILOU]/);
    expect(new Set(seen).size).toBe(32);
  });

  it('draws 100,000 distinct invoices for one day', () => {
    const now = new Date();
    const invoices = new Set(Array.from({ length: 100_000 }, () => newInvoiceNumber('T', now)));
    expect(invoices.size).toBe(100_000);
  });

  it.each(['', 't', 'ABCD', 'T-'])('refuses the prefix %p', (prefix) => {
    expect(() => newInvoiceNumber(prefix)).toThrow(/prefix/);
  });
});
