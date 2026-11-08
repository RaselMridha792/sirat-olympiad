import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { EnvVars } from '../../config/env';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PasswordService } from '../auth/password.service';
import type { PaymentConfig } from '../payments/payment.config';
import type { DemoQueue } from './demo.queue';
import { DemoService } from './demo.service';

const config = (allowed: string) =>
  ({ get: () => allowed }) as unknown as ConfigService<EnvVars, true>;

describe('DemoService while DEMO_DATA_ALLOWED is off', () => {
  it('refuses a load with 409 demo_not_allowed before touching the database, the hasher or the queue', async () => {
    const $transaction = jest.fn();
    const hash = jest.fn();
    const load = jest.fn();
    const service = new DemoService(
      { $transaction } as unknown as PrismaService,
      { status: 'end' } as unknown as Redis,
      config('false'),
      { enabled: false } as PaymentConfig,
      { load } as unknown as DemoQueue,
      { hash } as unknown as PasswordService,
    );
    const refusal = service.load({ id: 'a', ip: null }, 'client demo');
    await expect(refusal).rejects.toBeInstanceOf(ConflictException);
    await expect(refusal).rejects.toMatchObject({ response: { message: ['demo_not_allowed'] } });
    expect($transaction).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('still reports the switch in the status (the card hides the load button)', async () => {
    const service = new DemoService(
      { demoBatch: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaService,
      { status: 'end' } as unknown as Redis,
      config('false'),
      { enabled: false } as PaymentConfig,
      {} as DemoQueue,
      {} as PasswordService,
    );
    await expect(service.status()).resolves.toEqual({
      allowed: false,
      batch: null,
      progress: null,
      lastOutcome: null,
    });
  });
});
