import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { VerifyRequests } from '../verify/verify-requests';
import { PayStationHooks } from './paystation-hooks.service';

const INVOICE = 'T261031ABCDEFGHIJ';
const pending = {
  id: '0190f000-0000-7000-8000-000000000001',
  status: 'pending',
  trxId: null,
  expiresAt: new Date(Date.now() + 60_000),
  paymentUrl: 'https://checkout.test.invalid/x',
};

function setup(opts: { findUnique?: jest.Mock; create?: jest.Mock } = {}): {
  hooks: PayStationHooks;
  request: jest.Mock;
  create: jest.Mock;
} {
  const findUnique = opts.findUnique ?? jest.fn().mockResolvedValue(pending);
  const create = opts.create ?? jest.fn().mockResolvedValue({});
  const request = jest.fn().mockResolvedValue('requested');
  const prisma = { payment: { findUnique }, paymentEvent: { create } } as unknown as PrismaService;
  const hooks = new PayStationHooks(prisma, { request } as unknown as VerifyRequests);
  return { hooks, request, create };
}

beforeAll(() => Logger.overrideLogger(false));

describe('PayStationHooks (plan 6.2, 6.4)', () => {
  it('IPN: the database down answers 503, so PayStation retries; nothing is asked for', async () => {
    const { hooks, request } = setup({
      findUnique: jest.fn().mockRejectedValue(new Error('down')),
    });
    await expect(
      hooks.ipn({ invoice_number: INVOICE, trx_status: 'Success', trx_id: 'x' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(request).not.toHaveBeenCalled();
  });

  it('IPN: an event that cannot be written answers 503 too', async () => {
    const { hooks } = setup({ create: jest.fn().mockRejectedValue(new Error('down')) });
    await expect(hooks.ipn({ invoice_number: INVOICE })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('IPN: a body that is not an object, or a malformed invoice, is never looked up', async () => {
    const findUnique = jest.fn();
    const { hooks, request } = setup({ findUnique });
    expect(await hooks.ipn('not json')).toBe('unknown_invoice');
    expect(await hooks.ipn([INVOICE])).toBe('unknown_invoice');
    expect(await hooks.ipn({ invoice_number: "T1' OR 1=1" })).toBe('unknown_invoice');
    expect(findUnique).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('callback: never throws (the student is always redirected), even with the database down', async () => {
    const { hooks } = setup({ findUnique: jest.fn().mockRejectedValue(new Error('down')) });
    await expect(hooks.callback(INVOICE, { status: 'Successful' })).resolves.toBe('error');
  });

  it('callback: keeps at most 10 query keys and 200 characters a value', async () => {
    const { hooks, create } = setup();
    const query = Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [`k${i}`, 'v'.repeat(300)]),
    );
    expect(await hooks.callback(INVOICE, query)).toBe('verify_requested');
    const payload = (create.mock.calls[0]?.[0] as { data: { payload: Record<string, string> } })
      .data.payload;
    expect(Object.keys(payload)).toHaveLength(10);
    expect(Object.values(payload).every((v) => v.length === 200)).toBe(true);
  });
});
