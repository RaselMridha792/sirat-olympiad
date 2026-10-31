import { BadRequestException, Logger } from '@nestjs/common';
import { ADMIN_USER_EXPORT } from '@sirat/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { AdminUsersService, searchKind, userWhere } from './admin-users.service';

describe('searchKind', () => {
  it('tells a phone, an invoice, an email and a name apart', () => {
    expect(searchKind('01712345678')).toBe('phone');
    expect(searchKind('+8801712345678')).toBe('phone');
    expect(searchKind('8801712-345678')).toBe('phone');
    expect(searchKind('T261101ABCDEFGHJK2')).toBe('invoice');
    expect(searchKind('t261101abcdefghjk2')).toBe('invoice');
    // A long name without a digit is never an invoice.
    expect(searchKind('RAHIMUDDINKHAN')).toBe('name');
    expect(searchKind('rahim@school')).toBe('email');
    expect(searchKind('Rahim')).toBe('name');
  });
});

describe('userWhere', () => {
  it('is empty without filters', () => {
    expect(userWhere({})).toEqual({});
  });

  it('adds the phone and the invoice only when the term has their shape', () => {
    expect(userWhere({ q: 'Rahim' })).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: 'Rahim', mode: 'insensitive' } },
            { email: { contains: 'Rahim', mode: 'insensitive' } },
          ],
        },
      ],
    });
    const phone = userWhere({ q: '+8801712345678' });
    expect(JSON.stringify(phone)).toContain('"phone":"01712345678"');
    const invoice = userWhere({ q: 't261101abcdefghjk2' });
    expect(JSON.stringify(invoice)).toContain('"invoiceNumber":"T261101ABCDEFGHJK2"');
  });

  it('maps the boolean filters both ways', () => {
    expect(userWhere({ registered: true })).toEqual({ AND: [{ registration: { isNot: null } }] });
    expect(userWhere({ registered: false })).toEqual({ AND: [{ registration: { is: null } }] });
    expect(userWhere({ verified: true })).toEqual({ AND: [{ emailVerifiedAt: { not: null } }] });
    expect(userWhere({ verified: false })).toEqual({
      AND: [{ emailVerifiedAt: { equals: null } }],
    });
    expect(userWhere({ blocked: false, role: 'student', category: 'achiever' })).toEqual({
      AND: [{ role: 'student' }, { isBlocked: false }, { category: 'achiever' }],
    });
  });
});

describe('AdminUsersService.export', () => {
  const actor = { id: 'admin-1', ip: '203.0.113.1' };

  function stubPrisma(count: number, auditFails = false) {
    const audit = jest.fn(async () => {
      if (auditFails) throw new Error('database down');
      return {};
    });
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ role: 'admin', isBlocked: false })),
        count: jest.fn(async () => count),
        findMany: jest.fn(async () => []),
      },
      auditLog: { create: audit },
    } as unknown as PrismaService;
    return { prisma, audit };
  }

  it('refuses more rows than the limit before writing anything', async () => {
    const { prisma, audit } = stubPrisma(ADMIN_USER_EXPORT.maxRows + 1);
    await expect(
      new AdminUsersService(prisma).export({}, 'monthly report', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit).not.toHaveBeenCalled();
  });

  it('exports nothing when the audit row cannot be written, and logs no error message', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { prisma } = stubPrisma(3, true);
    await expect(
      new AdminUsersService(prisma).export({}, 'monthly report', actor),
    ).rejects.toMatchObject({ status: 503 });
    expect((prisma.user.findMany as jest.Mock).mock.calls).toHaveLength(0);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).not.toContain('database down');
    logged.mockRestore();
  });

  it('keeps only the kind of the search term in the audit row', async () => {
    const { prisma, audit } = stubPrisma(1);
    await new AdminUsersService(prisma).export(
      { q: '01712345678', category: 'activist' },
      'courier list',
      actor,
    );
    const data = (audit.mock.calls[0] as unknown as [{ data: { meta: unknown } }])[0].data;
    expect(data.meta).toEqual({
      filters: { category: 'activist', qKind: 'phone' },
      rowCount: 1,
      reason: 'courier list',
    });
    expect(JSON.stringify(data)).not.toContain('01712345678');
  });
});
