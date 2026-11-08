import type { ConfigService } from '@nestjs/config';
import { type Job, UnrecoverableError } from 'bullmq';
import type Redis from 'ioredis';
import type { EnvVars } from '../../config/env';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SecurityAlerts } from '../audit/security-alerts.service';
import type { PaymentConfig } from '../payments/payment.config';
import type { DemoLoadJobData } from './demo-queue';
import { DemoWorker } from './demo.worker';

describe('DemoWorker', () => {
  it('refuses a load job for good while the worker has DEMO_DATA_ALLOWED off, writing nothing', async () => {
    const findUnique = jest.fn();
    const raise = jest.fn();
    const worker = new DemoWorker(
      { demoBatch: { findUnique } } as unknown as PrismaService,
      { status: 'end' } as unknown as Redis,
      { get: () => 'false' } as unknown as ConfigService<EnvVars, true>,
      { enabled: false } as PaymentConfig,
      { raise } as unknown as SecurityAlerts,
    );
    const job = {
      name: 'load',
      id: 'load.b1',
      data: { batchId: 'b1', passwordHash: 'h', requestedBy: 'a' },
    } as unknown as Job<DemoLoadJobData>;
    await expect(worker.process(job)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(findUnique).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });

  it('refuses an unknown job name for good', async () => {
    const worker = new DemoWorker(
      {} as PrismaService,
      { status: 'end' } as unknown as Redis,
      { get: () => 'true' } as unknown as ConfigService<EnvVars, true>,
      { enabled: false } as PaymentConfig,
      {} as SecurityAlerts,
    );
    await expect(
      worker.process({ name: 'wipe', data: {} } as unknown as Job<DemoLoadJobData>),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
