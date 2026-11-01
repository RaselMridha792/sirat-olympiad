import { auditCsvRow, redactedMeta } from './audit-csv';

describe('redactedMeta', () => {
  it('replaces every email, Bangladeshi mobile number and IP address, wherever it sits', () => {
    const meta = {
      reason: 'student wrote rahim.uddin+test@example.com and 01712345678',
      email: 'RAHIM@Example.COM',
      nested: { phones: ['+8801912345678', '8801512345678'], note: 'call 01812345678.' },
      ip: '203.0.113.21',
      ipv6: '2001:db8:85a3::8a2e:370:7334',
      full6: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      loop: '::1',
    };
    const out = redactedMeta(meta);
    for (const needle of [
      'rahim.uddin',
      'example.com',
      'Example.COM',
      '01712345678',
      '01912345678',
      '01512345678',
      '01812345678',
      '203.0.113.21',
      '2001:db8',
      '2001:0db8',
      '"::1"',
    ])
      expect([needle, out.includes(needle)]).toEqual([needle, false]);
    expect(out).toContain('[email]');
    expect(out).toContain('[phone]');
    expect(out).toContain('[ip]');
  });

  it('leaves ordinary values alone: times, counts, codes, invoices and ids', () => {
    const meta = {
      at: '2026-11-01T06:00:00.000Z',
      clock: '12:30:45',
      rowCount: 1234,
      promoCode: 'SR-7K3QXD',
      invoice: 'SR20261101000123',
      id: '019a3b4c-5d6e-7f80-9123-456789abcdef',
      filters: { category: 'activist', qKind: 'email' },
    };
    expect(JSON.parse(redactedMeta(meta))).toEqual(meta);
  });

  it('writes nothing for a row without meta', () => {
    expect(redactedMeta(null)).toBe('');
    expect(redactedMeta(undefined)).toBe('');
  });
});

describe('auditCsvRow', () => {
  it('writes the Dhaka time, the actor and the redacted meta, with formula cells escaped', () => {
    const row = auditCsvRow({
      createdAt: new Date('2026-11-01T18:30:00Z'),
      action: 'users.exported',
      actorName: '=HYPERLINK("x")',
      actorRole: 'admin',
      system: false,
      entityType: 'user',
      entityId: null,
      meta: { reason: 'for a@b.co' },
    });
    expect(row).toContain('2026-11-02 00:30');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).not.toContain('a@b.co');
    expect(row.endsWith('\r\n')).toBe(true);
  });
});
